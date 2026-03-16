import { Console, Effect } from "effect"
import { FatalError } from "./errors.js"
import { Engine } from "./engine/Engine.js"

export interface GitResult {
  readonly stdout: string
}

const run = (args: string[]): Effect.Effect<GitResult, FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", ...args], {
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
          command: `git ${args.join(" ")}`,
          message: e.stderr.trim() || `exited with code ${e.exitCode}`,
        })
      }
      return new FatalError({
        command: `git ${args.join(" ")}`,
        message: `Failed to run git: ${error}`,
      })
    },
  })

const COMMIT_MSG_PROMPT = `Look at the following git diff and generate a conventional commit message.
Use the format: type(scope): description

Types: feat, fix, refactor, docs, test, chore, style, perf, ci, build
Scope is optional. Description should be lowercase, imperative, no period.

Output ONLY the commit message, nothing else. No markdown, no explanation.

Diff:
`

export const gitCommitAndPush = (): Effect.Effect<void, FatalError, Engine> =>
  Effect.gen(function* () {
    const status = yield* run(["status", "--porcelain"])
    if (!status.stdout.trim()) {
      yield* Console.log("No changes to commit.")
      return
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
    yield* Console.log("Committed.")

    yield* Console.log("Pushing...")
    yield* run(["push"])
    yield* Console.log("Pushed.")
  })
