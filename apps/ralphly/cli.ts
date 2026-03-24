#!/usr/bin/env bun
/**
 * ABOUTME: CLI entrypoint for ralphly — a Linear-aware worker that uses
 * blueprints for execution. This first slice is intentionally CLI-first
 * and manually invoked, with no HTTP server or webhook receiver.
 *
 * ## Operator flow
 *
 *   ralphly config              Show resolved configuration and value sources
 *   ralphly run --dry-run       Load and classify backlog, show what would happen
 *   ralphly run                 Drain the backlog sequentially, then exit
 *
 * The expected manual flow is: config → run --dry-run → run.
 * Each step is safe to repeat.
 *
 * ## Exit behavior
 *
 * `ralphly run` exits when no actionable work remains. The exit summary
 * includes a reason code so the operator knows why the worker stopped:
 *   - no_candidates:   nothing delegated to the agent
 *   - no_actionable:   candidates exist but all blocked/held/terminal/ineligible
 *   - backlog_drained: all actionable work was processed
 *   - iteration_limit: safety bound reached (should not happen in practice)
 */

import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Layer } from "effect"
import type { RunConfig } from "@workspace/blueprints"
import { AppLoggerLayer } from "./src/logger.js"
import { loadConfig } from "./src/config.js"
import { FatalError } from "./src/errors.js"
import { makeLinearLayer, loadCandidateWork, buildPromptFromIssue } from "./src/linear/index.js"
import { selectNext, formatBacklogSummary } from "./src/backlog.js"
import { runWorkerLoop, type WorkerRunSummary } from "./src/worker.js"
import { ClaudeEngineLayer } from "./src/engine.js"

// -- run subcommand --

const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Load and classify backlog, show what would happen, then exit without processing"),
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
            message: [
              "Missing required configuration:",
              ...result.error.missing.map((m) => `  ✗ ${m}`),
              "",
              "To get started:",
              "  1. Copy .env.example to .env and fill in your values",
              "  2. Run 'ralphly config' to verify everything resolves",
              "",
              "See the README for the full setup guide.",
            ].join("\n"),
          }),
        )
      }

      const cfg = result.config

      // Always show configuration summary at startup
      yield* Console.log("─── Configuration ───")
      yield* Console.log(`  Agent ID:     ${cfg.linear.agentId}`)
      yield* Console.log(`  Workspace:    ${cfg.workspacePath}`)
      yield* Console.log(`  Max attempts: ${cfg.maxAttempts}`)
      yield* Console.log(`  Checks:       ${cfg.checks.length > 0 ? cfg.checks.join(", ") : "(none)"}`)
      for (const warning of result.warnings) {
        yield* Console.log(`  ⚠ ${warning}`)
      }
      yield* Console.log("")

      const linearLayer = makeLinearLayer(cfg.linear)

      if (isDryRun) {
        // Dry run: load and classify work, print structured summary, exit
        yield* Console.log("─── Dry Run ───")
        const candidates = yield* loadCandidateWork({ agentId: cfg.linear.agentId }).pipe(
          Effect.provide(linearLayer),
        )

        if (candidates.length === 0) {
          yield* Console.log("No candidate work found. Nothing delegated to this agent.")
          yield* Console.log("")
          yield* Console.log("Exit: no_candidates — nothing to do.")
          return
        }

        const selection = selectNext(candidates)
        yield* Console.log(formatBacklogSummary(selection))
        yield* Console.log("")

        // Show each candidate with actionable detail
        yield* Console.log("─── Candidates ───")
        for (const classified of selection.classified) {
          const { work: { session, issue }, readiness, reason } = classified
          const marker = readiness === "actionable" ? "▶" : "·"
          yield* Console.log(
            `  ${marker} ${issue.identifier}: ${issue.title}`,
          )
          yield* Console.log(
            `    readiness: ${readiness} — ${reason}`,
          )
          yield* Console.log(
            `    session: ${session.id} (status: ${session.status})`,
          )
          if (readiness === "actionable") {
            const prompt = buildPromptFromIssue(issue)
            yield* Effect.logDebug(`Prompt preview (${prompt.length} chars):\n${prompt.slice(0, 200)}...`)
          }
        }
        yield* Console.log("")

        if (selection.next) {
          yield* Console.log(`Would process: ${selection.next.issue.identifier} — ${selection.next.issue.title}`)
          yield* Console.log(`  in workspace: ${cfg.workspacePath}`)
        } else {
          yield* Console.log("No actionable work. Nothing would be processed.")
        }
        yield* Console.log("")
        yield* Console.log("Exit: dry run complete — no changes made.")
        return
      }

      // Full run: drain the backlog through the worker loop
      yield* Console.log("─── Worker Run ───")
      yield* Console.log(`  Targeting workspace: ${cfg.workspacePath}`)
      yield* Console.log("")
      yield* Effect.logInfo("Starting worker loop — draining backlog sequentially")

      const runConfig: RunConfig = {
        maxAttempts: cfg.maxAttempts,
        checks: [...cfg.checks],
        gitMode: "none",
        report: "none",
      }

      const summary: WorkerRunSummary = yield* runWorkerLoop({
        agentId: cfg.linear.agentId,
        workspace: cfg.workspacePath,
        config: runConfig,
        engineLayer: ClaudeEngineLayer,
      }).pipe(Effect.provide(linearLayer))

      // Report final summary
      yield* Console.log("")
      yield* Console.log("─── Summary ───")
      yield* Console.log(`  Processed:  ${summary.processed}`)
      yield* Console.log(`  Succeeded:  ${summary.succeeded}`)
      yield* Console.log(`  Error-held: ${summary.errorHeld}`)
      yield* Console.log(`  Retried:    ${summary.retried}`)
      yield* Console.log("")

      if (summary.processed === 0) {
        yield* Console.log(`Exit: ${summary.exitReason} — no work processed.`)
      } else if (summary.succeeded === summary.processed) {
        yield* Console.log(
          `Exit: ${summary.exitReason} — all ${summary.processed} issue(s) succeeded.`,
        )
      } else {
        yield* Console.log(
          `Exit: ${summary.exitReason} — ${summary.succeeded}/${summary.processed} succeeded, ${summary.errorHeld} error-held.`,
        )
      }
    }),
)

// -- config subcommand --

const configCmd = Command.make("config", {}, () =>
  Effect.gen(function* () {
    const result = loadConfig()

    if (!result.ok) {
      yield* Console.log("─── Configuration (incomplete) ───")
      yield* Console.log("")
      yield* Console.log("Missing required values:")
      for (const m of result.error.missing) {
        yield* Console.log(`  ✗ ${m}`)
      }
      yield* Console.log("")
      yield* Console.log("To get started:")
      yield* Console.log("  1. Copy .env.example to .env and fill in your values")
      yield* Console.log("  2. Re-run 'ralphly config' to verify")
      yield* Console.log("")
      yield* Console.log("You can also set values in .ralphly/config.json (env vars take precedence).")
      yield* Console.log("See the README for the full setup guide.")
      return
    }

    const cfg = result.config

    // Show resolved configuration with source hints
    yield* Console.log("─── Configuration ───")
    yield* Console.log("")
    yield* Console.log(`  Workspace:    ${cfg.workspacePath}`)
    yield* Console.log(`                ${describeSource("RALPHLY_WORKSPACE_PATH", "RALPHLY_REPO_PATH")}`)
    yield* Console.log(`  Agent ID:     ${cfg.linear.agentId}`)
    yield* Console.log(`                ${describeSource("LINEAR_AGENT_ID")}`)
    yield* Console.log(`  API key:      ${cfg.linear.apiKey.slice(0, 8)}...`)
    yield* Console.log(`                ${describeSource("LINEAR_API_KEY")}`)
    yield* Console.log(`  Max attempts: ${cfg.maxAttempts}`)
    yield* Console.log(`  Checks:       ${cfg.checks.length > 0 ? cfg.checks.join(", ") : "(none)"}`)
    yield* Console.log("")
    for (const warning of result.warnings) {
      yield* Console.log(`  ⚠ ${warning}`)
    }
    if (result.warnings.length > 0) yield* Console.log("")
    yield* Console.log("Configuration is complete. Ready to run.")
  }),
)

/**
 * Describe the source of a config value (env var or config file).
 * Accepts an optional deprecated alias key for backward-compatibility reporting.
 */
const describeSource = (envKey: string, deprecatedKey?: string): string => {
  if (process.env[envKey]) {
    return `(from env: ${envKey})`
  }
  if (deprecatedKey && process.env[deprecatedKey]) {
    return `(from env: ${deprecatedKey} — deprecated, use ${envKey})`
  }
  return "(from .ralphly/config.json)"
}

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
