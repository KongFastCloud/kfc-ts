/**
 * ABOUTME: Deterministic worktree bootstrap runner.
 * Detects package manager from lockfiles and runs a strict install command.
 */

import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"

export type BootstrapPackageManager = "pnpm" | "bun" | "yarn" | "npm"

export const detectBootstrapPackageManager = (worktreePath: string): BootstrapPackageManager => {
  if (fs.existsSync(path.join(worktreePath, "bun.lock")) || fs.existsSync(path.join(worktreePath, "bun.lockb"))) {
    return "bun"
  }
  if (fs.existsSync(path.join(worktreePath, "pnpm-lock.yaml"))) {
    return "pnpm"
  }
  if (fs.existsSync(path.join(worktreePath, "yarn.lock"))) {
    return "yarn"
  }
  return "npm"
}

export const bootstrapCommandFor = (pm: BootstrapPackageManager): readonly [string, string[]] => {
  switch (pm) {
    case "pnpm":
      return ["pnpm", ["install", "--frozen-lockfile"]]
    case "bun":
      return ["bun", ["install", "--frozen-lockfile"]]
    case "yarn":
      return ["yarn", ["install", "--frozen-lockfile"]]
    case "npm":
      return ["npm", ["ci"]]
  }
}

export const bootstrapEpicWorktree = (
  worktreePath: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    if (!fs.existsSync(path.join(worktreePath, "package.json"))) {
      yield* Effect.logInfo(`Skipping bootstrap at ${worktreePath}: no package.json found.`)
      return
    }

    const pm = detectBootstrapPackageManager(worktreePath)
    const [command, args] = bootstrapCommandFor(pm)
    const pretty = `${command} ${args.join(" ")}`

    yield* Effect.logInfo(`Bootstrapping epic worktree with: ${pretty}`)

    const result = yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([command, ...args], {
          cwd: worktreePath,
          stdout: "pipe",
          stderr: "pipe",
        })
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        const exitCode = await proc.exited
        return { stdout, stderr, exitCode }
      },
      catch: (error) =>
        new FatalError({
          command: pretty,
          message: `Failed to start bootstrap command: ${error}`,
        }),
    })

    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new FatalError({
          command: pretty,
          message: result.stderr.trim() || result.stdout.trim() || `Bootstrap command failed with exit code ${result.exitCode}`,
        }),
      )
    }

    yield* Effect.logInfo(`Bootstrap completed with: ${pretty}`)
  }).pipe(
    Effect.annotateLogs({ worktreePath }),
  )
