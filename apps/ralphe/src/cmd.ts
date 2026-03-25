import { Effect } from "effect"
import { CheckFailure, FatalError } from "./errors.js"

export interface CmdResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export const cmd = (
  command: string,
  cwd?: string,
): Effect.Effect<CmdResult, CheckFailure | FatalError> =>
  Effect.gen(function* () {
    yield* Effect.logDebug(`Running: ${command}`)

    const result = yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn(["sh", "-c", command], {
          stdout: "pipe",
          stderr: "pipe",
          cwd,
        })

        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        const exitCode = await proc.exited

        if (exitCode !== 0) {
          throw { _tag: "check", command, stderr, exitCode }
        }

        return { stdout, stderr, exitCode } satisfies CmdResult
      },
      catch: (error) => {
        if (
          error &&
          typeof error === "object" &&
          "_tag" in error &&
          error._tag === "check"
        ) {
          const e = error as unknown as {
            command: string
            stderr: string
            exitCode: number
          }
          return new CheckFailure({
            command: e.command,
            stderr: e.stderr,
            exitCode: e.exitCode,
          })
        }
        return new FatalError({
          command,
          message: `Failed to spawn command: ${error}`,
        })
      },
    })

    yield* Effect.logInfo("Check passed.")
    yield* Effect.logDebug(`Passed: ${command}`)
    return result
  })
