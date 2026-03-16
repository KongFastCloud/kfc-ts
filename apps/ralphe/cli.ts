#!/usr/bin/env bun
import { Args, Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Layer, pipe } from "effect"
import { checkbox, select, input } from "@inquirer/prompts"
import { ClaudeEngineLayer } from "./src/engine/ClaudeEngine.js"
import { CodexEngineLayer } from "./src/engine/CodexEngine.js"
import { Engine } from "./src/engine/Engine.js"
import { agent } from "./src/agent.js"
import { cmd } from "./src/cmd.js"
import { loop } from "./src/loop.js"
import { loadConfig, saveConfig, type RalpheConfig } from "./src/config.js"
import { detectProject } from "./src/detect.js"

// -- config subcommand --

const config = Command.make("config", {}, () =>
  Effect.gen(function* () {
    const detected = detectProject()
    const existing = loadConfig()

    if (detected.language) {
      yield* Console.log(`Detected: ${detected.language} (${detected.packageManager})`)
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
            message: "Check commands (space to toggle)",
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

    const customCheck = yield* Effect.promise(() =>
      input({
        message: "Add custom check command (leave empty to skip)",
      }),
    )

    if (customCheck.trim()) {
      checks.push(customCheck.trim())
    }

    const maxAttemptsStr = yield* Effect.promise(() =>
      input({
        message: "Max attempts",
        default: String(existing.maxAttempts),
      }),
    )

    const newConfig: RalpheConfig = {
      engine: engineChoice,
      maxAttempts: parseInt(maxAttemptsStr, 10) || 2,
      checks,
    }

    saveConfig(newConfig)
    yield* Console.log(`\nSaved .ralphe/config.json`)

    if (checks.length > 0) {
      yield* Console.log(`Checks: ${checks.join(", ")}`)
    } else {
      yield* Console.log(`No checks configured — agent will run without verification.`)
    }
  }),
)

// -- run subcommand --

const task = Args.text({ name: "task" })
const engineFlag = Options.choice("engine", ["claude", "codex"]).pipe(
  Options.optional,
)

const run = Command.make(
  "run",
  { task, engine: engineFlag },
  ({ task, engine: engineOverride }) =>
    Effect.gen(function* () {
      const cfg = loadConfig()
      const engineChoice = engineOverride.pipe(
        (opt) => opt._tag === "Some" ? opt.value : cfg.engine,
      )

      yield* Console.log(`Task: ${task}`)
      yield* Console.log(`Engine: ${engineChoice}`)
      if (cfg.checks.length > 0) {
        yield* Console.log(`Checks: ${cfg.checks.join(", ")}`)
      } else {
        yield* Console.log(`No checks configured — running agent only.`)
      }

      const workflow = cfg.checks.length > 0
        ? loop(
            (feedback) => {
              let pipeline: Effect.Effect<unknown, any, Engine> = agent(task, { feedback })
              for (const check of cfg.checks) {
                pipeline = pipe(pipeline, Effect.andThen(cmd(check)))
              }
              return pipeline
            },
            { maxAttempts: cfg.maxAttempts },
          )
        : agent(task).pipe(Effect.asVoid)

      const engineLayer: Layer.Layer<Engine> =
        engineChoice === "codex" ? CodexEngineLayer : ClaudeEngineLayer

      yield* Effect.provide(workflow, engineLayer)

      yield* Console.log("Done!")
    }),
)

// -- root --

const ralphe = Command.make("ralphe").pipe(
  Command.withSubcommands([config, run]),
)

const cli = Command.run(ralphe, {
  name: "ralphe",
  version: "0.0.1",
})

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
