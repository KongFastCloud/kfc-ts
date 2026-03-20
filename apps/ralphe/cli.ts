#!/usr/bin/env bun
import { Args, Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect } from "effect"
import { checkbox, select, input } from "@inquirer/prompts"
import { FatalError } from "./src/errors.js"
import { loadConfig, saveConfig, resolveRunConfig, type GitMode, type RalpheConfig } from "./src/config.js"
import { detectProject } from "./src/detect.js"
import { installGlobalSkill } from "./src/skill.js"
import { runTask } from "./src/runTask.js"
import { watch } from "./src/watcher.js"
import { launchWatchTui } from "./src/watchTui.js"
import fs from "node:fs"

// -- config subcommand --

const config = Command.make("config", {}, () =>
  Effect.gen(function* () {
    const detected = detectProject()
    const existing = loadConfig()

    if (detected.packageManager) {
      yield* Console.log(`Detected root package manager: ${detected.packageManager}`)
    }

    const engineChoice = yield* Effect.promise(() =>
      select({
        message: "Engine",
        choices: [
          { name: "claude", value: "claude" as const },
          { name: "codex", value: "codex" as const },
        ],
        default: existing.engine,
      }),
    )

    const checks = detected.checks.length > 0
      ? yield* Effect.promise(() =>
          checkbox({
            message: "Root check commands (space to toggle)",
            choices: detected.checks.map((c) => ({
              name: c.command,
              value: c.command,
              checked: existing.checks.length > 0
                ? existing.checks.includes(c.command)
                : c.enabledByDefault,
            })),
          }),
        )
      : []

    const maxAttemptsStr = yield* Effect.promise(() =>
      input({
        message: "Max attempts",
        default: String(existing.maxAttempts),
      }),
    )

    const reportMode = yield* Effect.promise(() =>
      select({
        message: "Report mode",
        choices: [
          { name: "none", value: "none" as const, description: "No verification report" },
          { name: "basic", value: "basic" as const, description: "Verify via terminal" },
          { name: "browser", value: "browser" as const, description: "Verify with agent-browser (video)" },
        ],
        default: existing.report,
      }),
    )

    const gitMode = yield* Effect.promise(() =>
      select({
        message: "Git mode",
        choices: [
          { name: "none", value: "none" as const, description: "Do not run git operations" },
          { name: "commit", value: "commit" as const, description: "Stage and commit only" },
          { name: "commit_and_push", value: "commit_and_push" as const, description: "Stage, commit, and push" },
          {
            name: "commit_and_push_and_wait_ci",
            value: "commit_and_push_and_wait_ci" as const,
            description: "Stage, commit, push, and wait for GitHub Actions CI",
          },
        ],
        default: existing.git.mode,
      }),
    )
    const newConfig: RalpheConfig = {
      engine: engineChoice,
      maxAttempts: parseInt(maxAttemptsStr, 10) || 2,
      checks,
      git: { mode: gitMode },
      report: reportMode,
    }

    saveConfig(newConfig)
    yield* Console.log(`\nSaved repo config to .ralphe/config.json`)

    if (checks.length > 0) {
      yield* Console.log(`Root checks: ${checks.join(", ")}`)
    } else {
      yield* Console.log(`No root checks configured — agent will run without verification.`)
    }
  }),
)

// -- run subcommand --

const task = Args.text({ name: "task" }).pipe(Args.optional)
const file = Options.file("file").pipe(
  Options.withAlias("f"),
  Options.optional,
)
const engineFlag = Options.choice("engine", ["claude", "codex"]).pipe(
  Options.optional,
)
const gitModeFlag = Options.choice("git-mode", [
  "none",
  "commit",
  "commit_and_push",
  "commit_and_push_and_wait_ci",
]).pipe(
  Options.optional,
)
const run = Command.make(
  "run",
  { task, file, engine: engineFlag, gitMode: gitModeFlag },
  ({ task: taskArg, file: fileOpt, engine: engineOverride, gitMode: gitModeOverride }) =>
    Effect.gen(function* () {
      if (fileOpt._tag === "Some" && !fs.existsSync(fileOpt.value)) {
        return yield* Effect.fail(
          new FatalError({ command: "file", message: `File not found: ${fileOpt.value}` }),
        )
      }

      if (fileOpt._tag === "None" && taskArg._tag === "None") {
        return yield* Effect.fail(
          new FatalError({ command: "run", message: `Provide a task as text or with --file` }),
        )
      }

      const cfg = loadConfig()
      const engineChoice = engineOverride.pipe(
        (opt) => opt._tag === "Some" ? opt.value : cfg.engine,
      ) as "claude" | "codex"
      const runConfig = resolveRunConfig(
        cfg,
        gitModeOverride.pipe((opt) => opt._tag === "Some" ? opt.value : undefined) as GitMode | undefined,
      )

      // Resolve task from file or positional arg
      let task: string = ""
      if (fileOpt._tag === "Some") {
        const filePath = fileOpt.value
        task = fs.readFileSync(filePath, "utf-8")
        yield* Console.log(`Task from file: ${filePath}`)
      } else if (taskArg._tag === "Some") {
        task = taskArg.value
        yield* Console.log(`Task: ${task}`)
      }
      yield* Console.log(`Engine: ${engineChoice}`)
      if (cfg.checks.length > 0) {
        yield* Console.log(`Root checks: ${cfg.checks.join(", ")}`)
      } else {
        yield* Console.log(`No root checks configured — running agent only.`)
      }

      const result = yield* runTask(task, runConfig, { engineOverride: engineChoice })

      if (!result.success) {
        return yield* Effect.fail(
          new FatalError({ command: "run", message: result.error ?? "Task execution failed" }),
        )
      }

      yield* Console.log("Done!")
    }),
)

// -- skill subcommand --

const skill = Command.make("skill", {}, () =>
  Effect.gen(function* () {
    const installed = yield* installGlobalSkill()

    yield* Console.log("Installed ralphe skill globally:")
    for (const target of installed) {
      yield* Console.log(`- ${target.name}: ${target.path}`)
    }
  }),
)

// -- watch subcommand --

const watchEngineFlag = Options.choice("engine", ["claude", "codex"]).pipe(
  Options.optional,
)
const pollInterval = Options.integer("interval").pipe(
  Options.withAlias("i"),
  Options.withDefault(10),
)
const headlessFlag = Options.boolean("headless").pipe(
  Options.withDefault(false),
)

const watchCmd = Command.make(
  "watch",
  { engine: watchEngineFlag, interval: pollInterval, headless: headlessFlag },
  ({ engine: engineOverride, interval, headless }) =>
    Effect.gen(function* () {
      const engineOpt = engineOverride._tag === "Some"
        ? engineOverride.value as "claude" | "codex"
        : undefined

      if (headless) {
        // Original headless watcher (no TUI)
        yield* Console.log("Starting Beads watcher (headless)...")
        yield* watch({
          pollIntervalMs: interval * 1000,
          engineOverride: engineOpt,
        })
      } else {
        // Interactive TUI mode (default) — includes in-process worker
        yield* launchWatchTui({
          refreshIntervalMs: interval * 1000,
          engineOverride: engineOpt,
        })
      }
    }),
)

// -- root --

const ralphe = Command.make("ralphe").pipe(
  Command.withSubcommands([config, run, skill, watchCmd]),
)

const cli = Command.run(ralphe, {
  name: "ralphe",
  version: "0.0.1",
})

export { resolveRunConfig }

export const runCli = (argv: string[]) =>
  cli(argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)

if (import.meta.main) {
  runCli(process.argv)
}
