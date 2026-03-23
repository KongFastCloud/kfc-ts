#!/usr/bin/env bun
/**
 * ABOUTME: CLI entrypoint for ralphly — a Linear-aware worker that uses
 * blueprints for execution. This first slice is intentionally CLI-first
 * and manually invoked, with no HTTP server or webhook receiver.
 */

import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Layer } from "effect"
import type { RunConfig } from "@workspace/blueprints"
import { AppLoggerLayer } from "./src/logger.js"
import { loadConfig } from "./src/config.js"
import { FatalError } from "./src/errors.js"
import { makeLinearLayer, loadCandidateWork, buildPromptFromIssue } from "./src/linear/index.js"
import { runIssue } from "./src/runner.js"

// -- run subcommand --

const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Print resolved config and exit without processing work"),
  Options.withDefault(false),
)

const run = Command.make(
  "run",
  { dryRun },
  ({ dryRun: isDryRun }) =>
    Effect.gen(function* () {
      const result = loadConfig()

      if (!result.ok) {
        return yield* Effect.fail(
          new FatalError({
            command: "run",
            message: `Missing required configuration:\n${result.error.missing.map((m) => `  - ${m}`).join("\n")}`,
          }),
        )
      }

      const cfg = result.config

      yield* Effect.logInfo(`Agent ID: ${cfg.linear.agentId}`)
      yield* Effect.logInfo(`Repo path: ${cfg.repoPath}`)
      yield* Effect.logInfo(`Max attempts: ${cfg.maxAttempts}`)
      if (cfg.checks.length > 0) {
        yield* Effect.logInfo(`Checks: ${cfg.checks.join(", ")}`)
      }

      if (isDryRun) {
        yield* Console.log("Dry run — config loaded successfully. Exiting.")
        return
      }

      // Query Linear for actionable work for the configured agent
      const linearLayer = makeLinearLayer(cfg.linear)

      const candidates = yield* loadCandidateWork({ agentId: cfg.linear.agentId }).pipe(
        Effect.provide(linearLayer),
      )

      yield* Effect.logInfo(`Found ${candidates.length} candidate work item(s)`)

      if (candidates.length === 0) {
        yield* Console.log("No actionable work found. Exiting.")
        return
      }

      for (const { session, issue } of candidates) {
        yield* Effect.logInfo(
          `  ${issue.identifier}: ${issue.title} (session: ${session.id}, status: ${session.status})`,
        )
        const prompt = buildPromptFromIssue(issue)
        yield* Effect.logDebug(`Prompt preview (${prompt.length} chars):\n${prompt.slice(0, 200)}...`)
      }

      // Process the first candidate through blueprints
      // (single-issue path — full backlog draining is a future slice)
      const firstCandidate = candidates[0]!
      yield* Effect.logInfo(
        `Processing ${firstCandidate.issue.identifier} through blueprints...`,
      )

      // Build blueprints RunConfig from ralphly config
      const runConfig: RunConfig = {
        maxAttempts: cfg.maxAttempts,
        checks: [...cfg.checks],
        gitMode: "none",
        report: "none",
      }

      // TODO: Replace with real engine layer when engine selection is implemented.
      // For now, this placeholder makes the CLI structurally complete.
      // The actual engine layer will be provided when ralphly gets engine configuration.
      yield* Console.log(
        `Ready to process ${firstCandidate.issue.identifier}. ` +
        `Engine layer not yet configured — use runIssue() programmatically with an engine layer.`,
      )
    }),
)

// -- config subcommand --

const configCmd = Command.make("config", {}, () =>
  Effect.gen(function* () {
    const result = loadConfig()

    if (!result.ok) {
      yield* Console.log("Configuration incomplete. Missing:")
      for (const m of result.error.missing) {
        yield* Console.log(`  - ${m}`)
      }
      return
    }

    const cfg = result.config
    yield* Console.log("Current configuration:")
    yield* Console.log(`  Repo path:    ${cfg.repoPath}`)
    yield* Console.log(`  Agent ID:     ${cfg.linear.agentId}`)
    yield* Console.log(`  API key:      ${cfg.linear.apiKey.slice(0, 8)}...`)
    yield* Console.log(`  Max attempts: ${cfg.maxAttempts}`)
    yield* Console.log(`  Checks:       ${cfg.checks.length > 0 ? cfg.checks.join(", ") : "(none)"}`)
  }),
)

// -- root --

const ralphly = Command.make("ralphly").pipe(
  Command.withSubcommands([run, configCmd]),
)

const cli = Command.run(ralphly, {
  name: "ralphly",
  version: "0.0.1",
})

export const runCli = (argv: string[]) => {
  cli(argv).pipe(
    Effect.provide(Layer.merge(BunContext.layer, AppLoggerLayer)),
    BunRuntime.runMain,
  )
}

if (import.meta.main) {
  runCli(process.argv)
}
