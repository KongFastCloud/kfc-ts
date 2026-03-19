import { Console, Effect } from "effect"
import { FatalError } from "./errors.js"
import { Engine } from "./engine/Engine.js"

export interface GitResult {
  readonly stdout: string
}

export interface GitCommitResult {
  readonly message: string
  readonly hash: string
}

export interface GitPushResult {
  readonly remote: string
  readonly ref: string
  readonly output: string
}

export interface GitHubCiResult {
  readonly runId: number
  readonly status: string
  readonly conclusion: string | null
  readonly url: string | null
  readonly workflowName: string | null
}

interface CliResult {
  readonly stdout: string
}

const runCommand = (command: string, args: string[]): Effect.Effect<CliResult, FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        throw { stderr, exitCode }
      }

      return { stdout }
    },
    catch: (error) => {
      if (error && typeof error === "object" && "stderr" in error) {
        const e = error as { stderr: string; exitCode: number }
        return new FatalError({
          command: `${command} ${args.join(" ")}`,
          message: e.stderr.trim() || `exited with code ${e.exitCode}`,
        })
      }
      return new FatalError({
        command: `${command} ${args.join(" ")}`,
        message: `Failed to run ${command}: ${error}`,
      })
    },
  })

const run = (args: string[]): Effect.Effect<GitResult, FatalError> =>
  runCommand("git", args)

const runGh = (args: string[]): Effect.Effect<CliResult, FatalError> =>
  runCommand("gh", args)

const COMMIT_MSG_PROMPT = `Look at the following git diff and generate a conventional commit message.
Use the format: type(scope): description

Types: feat, fix, refactor, docs, test, chore, style, perf, ci, build
Scope is optional. Description should be lowercase, imperative, no period.

Output ONLY the commit message, nothing else. No markdown, no explanation.

Diff:
`

const CI_RUN_DISCOVERY_ATTEMPTS = 12
const CI_STATUS_POLL_ATTEMPTS = 180
const CI_STATUS_POLL_DELAY_MS = 10000

interface GhRun {
  readonly databaseId: number
  readonly status: string
  readonly conclusion: string | null
  readonly url: string | null
  readonly workflowName: string | null
}

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null

const parseGhRunList = (raw: string): GhRun[] | undefined => {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error("Expected an array")
    }
    return parsed
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
      .map((item) => ({
        databaseId: Number(item.databaseId),
        status: String(item.status ?? ""),
        conclusion: asNullableString(item.conclusion),
        url: asNullableString(item.url),
        workflowName: asNullableString(item.workflowName),
      }))
      .filter((item) => Number.isFinite(item.databaseId) && item.databaseId > 0)
  } catch {
    return undefined
  }
}

export const gitCommitAndPush = (): Effect.Effect<void, FatalError, Engine> =>
  Effect.gen(function* () {
    const commitResult = yield* gitCommit()
    if (!commitResult) {
      return
    }

    yield* gitPush()
  })

export const gitCommit = (): Effect.Effect<GitCommitResult | undefined, FatalError, Engine> =>
  Effect.gen(function* () {
    const status = yield* run(["status", "--porcelain"])
    if (!status.stdout.trim()) {
      yield* Console.log("No changes to commit.")
      return undefined
    }

    yield* run(["add", "-A"])

    const diff = yield* run(["diff", "--staged"])

    yield* Console.log("Generating commit message...")
    const engine = yield* Engine
    const result = yield* engine.execute(
      COMMIT_MSG_PROMPT + diff.stdout,
      process.cwd(),
    ).pipe(
      Effect.catchTag("CheckFailure", (err) =>
        Effect.fail(new FatalError({ command: err.command, message: err.stderr })),
      ),
    )

    const message = result.response.trim()
    yield* Console.log(`Commit: ${message}`)

    yield* run(["commit", "-m", message])
    const hash = (yield* run(["rev-parse", "--short", "HEAD"])).stdout.trim()
    yield* Console.log("Committed.")

    return { message, hash }
  })

export const gitPush = (): Effect.Effect<GitPushResult, FatalError> =>
  Effect.gen(function* () {
    const ref = (yield* run(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
    const remote = yield* run(["config", `branch.${ref}.remote`]).pipe(
      Effect.map((result) => result.stdout.trim() || "origin"),
      Effect.catchTag("FatalError", () => Effect.succeed("origin")),
    )

    yield* Console.log("Pushing...")
    const pushOutput = (yield* run(["push"])).stdout.trim()
    yield* Console.log("Pushed.")

    return { remote, ref, output: pushOutput }
  })

export const gitWaitForCi = (): Effect.Effect<GitHubCiResult, FatalError> =>
  Effect.gen(function* () {
    // Early check produces a clear error when GitHub CLI is missing.
    yield* runGh(["--version"])

    const sha = (yield* run(["rev-parse", "HEAD"])).stdout.trim()
    yield* Console.log(`Waiting for GitHub Actions for commit ${sha.slice(0, 7)}...`)

    const listCommand = `gh run list --commit ${sha} --limit 20 --json databaseId,status,conclusion,url,workflowName`

    for (let attempt = 0; attempt < CI_STATUS_POLL_ATTEMPTS; attempt += 1) {
      const listOutput = yield* runGh([
        "run",
        "list",
        "--commit",
        sha,
        "--limit",
        "20",
        "--json",
        "databaseId,status,conclusion,url,workflowName",
      ])
      const runs = parseGhRunList(listOutput.stdout)
      if (!runs) {
        return yield* Effect.fail(
          new FatalError({
            command: listCommand,
            message: "Failed to parse GitHub Actions run metadata.",
          }),
        )
      }

      if (runs.length === 0) {
        if (attempt < CI_RUN_DISCOVERY_ATTEMPTS - 1) {
          yield* Console.log(`No CI run found yet for ${sha.slice(0, 7)}; retrying in 10s...`)
          yield* Effect.sleep(CI_STATUS_POLL_DELAY_MS)
          continue
        }

        return yield* Effect.fail(
          new FatalError({
            command: listCommand,
            message: `No GitHub Actions run found for commit ${sha.slice(0, 7)} within ${CI_RUN_DISCOVERY_ATTEMPTS * (CI_STATUS_POLL_DELAY_MS / 1000)}s.`,
          }),
        )
      }

      const runningRuns = runs.filter((run) => run.status !== "completed")
      if (runningRuns.length > 0) {
        yield* Console.log(
          `CI in progress (${runningRuns.length}/${runs.length} still running). Checking again in 10s...`,
        )
        yield* Effect.sleep(CI_STATUS_POLL_DELAY_MS)
        continue
      }

      const failingRun = runs.find((run) =>
        run.conclusion !== "success" &&
        run.conclusion !== "skipped" &&
        run.conclusion !== "neutral"
      )
      if (failingRun) {
        return yield* Effect.fail(
          new FatalError({
            command: listCommand,
            message: `CI failed for run ${failingRun.databaseId} (conclusion: ${failingRun.conclusion ?? "unknown"}).`,
          }),
        )
      }

      const latestRun = runs[0]
      yield* Console.log(`CI succeeded across ${runs.length} run(s).`)
      return {
        runId: latestRun.databaseId,
        status: latestRun.status,
        conclusion: latestRun.conclusion,
        url: latestRun.url,
        workflowName: latestRun.workflowName,
      }
    }

    return yield* Effect.fail(
      new FatalError({
        command: listCommand,
        message: `Timed out waiting for CI completion for commit ${sha.slice(0, 7)} after ${CI_STATUS_POLL_ATTEMPTS * (CI_STATUS_POLL_DELAY_MS / 1000)}s.`,
      }),
    )
  })
