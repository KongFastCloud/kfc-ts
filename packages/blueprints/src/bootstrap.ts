/**
 * ABOUTME: Lockfile-aware bootstrap install primitive.
 * Detects package manager from workspace lockfiles and runs a strict
 * install command. Skips bootstrap when package.json is absent.
 *
 * This primitive is tracker-agnostic and reusable across apps. It accepts
 * an explicit workspace path and never defaults to process.cwd().
 */

import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Package manager types and detection
// ---------------------------------------------------------------------------

/**
 * Supported package managers for bootstrap install detection.
 */
export type BootstrapPackageManager = "pnpm" | "bun" | "yarn" | "npm"

/**
 * Detect the package manager for a workspace by inspecting lockfiles.
 *
 * Detection order (first match wins):
 * 1. `bun.lock` or `bun.lockb` → bun
 * 2. `pnpm-lock.yaml` → pnpm
 * 3. `yarn.lock` → yarn
 * 4. fallback → npm
 *
 * @param workspace - Absolute path to the workspace directory.
 */
export const detectPackageManager = (workspace: string): BootstrapPackageManager => {
  if (
    fs.existsSync(path.join(workspace, "bun.lock")) ||
    fs.existsSync(path.join(workspace, "bun.lockb"))
  ) {
    return "bun"
  }
  if (fs.existsSync(path.join(workspace, "pnpm-lock.yaml"))) {
    return "pnpm"
  }
  if (fs.existsSync(path.join(workspace, "yarn.lock"))) {
    return "yarn"
  }
  return "npm"
}

// ---------------------------------------------------------------------------
// Command mapping
// ---------------------------------------------------------------------------

/**
 * Map a package manager to its strict (frozen-lockfile) install command.
 *
 * @param pm - The detected package manager.
 * @returns A tuple of [binary, args] for spawning.
 */
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

// ---------------------------------------------------------------------------
// Bootstrap install primitive
// ---------------------------------------------------------------------------

/**
 * Run lockfile-aware dependency installation in a workspace.
 *
 * Behavior:
 * - When `package.json` is absent in the workspace, bootstrap is skipped
 *   (no-op success).
 * - When `package.json` is present, the package manager is detected from
 *   lockfiles and a strict install command is executed.
 * - Bootstrap failure is surfaced as a terminal `FatalError` for the caller
 *   to handle.
 *
 * @param workspace - Absolute path to the workspace directory.
 */
export const bootstrapInstall = (
  workspace: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    if (!fs.existsSync(path.join(workspace, "package.json"))) {
      yield* Effect.logInfo(`Skipping bootstrap at ${workspace}: no package.json found.`)
      return
    }

    const pm = detectPackageManager(workspace)
    const [command, args] = bootstrapCommandFor(pm)
    const pretty = `${command} ${args.join(" ")}`

    yield* Effect.logInfo(`Bootstrapping workspace with: ${pretty}`)

    const result = yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([command, ...args], {
          cwd: workspace,
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
    Effect.annotateLogs({ workspace }),
  )
