/**
 * ABOUTME: Copy-ignored primitive for workspace bootstrap.
 * Copies git-ignored entries from a source workspace to a destination workspace
 * so that target worktrees receive local artifacts (envs, caches, build output)
 * needed for execution.
 *
 * Supports optional narrowing via `.worktreeinclude` — when present, only listed
 * entries are copied; when absent, all git-ignored entries are copied.
 *
 * This primitive is tracker-agnostic and reusable across apps. It accepts
 * explicit source and destination paths and never defaults to process.cwd().
 *
 * ## Design invariants
 *
 * - Source and destination are explicit — no implicit defaults.
 * - Git ignored discovery uses `git ls-files --ignored --exclude-standard -o --directory`.
 * - `.worktreeinclude` is a newline-separated list of relative paths (globs not supported).
 * - Non-copyable entries (broken symlinks, permission errors) are collected and
 *   surfaced through explicit failure signaling.
 * - Destination files are overwritten unconditionally.
 */

import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKTREEINCLUDE_FILE = ".worktreeinclude"

// ---------------------------------------------------------------------------
// Git ignored discovery
// ---------------------------------------------------------------------------

/**
 * Discover git-ignored entries in a workspace using repository ignore semantics.
 *
 * Uses `git ls-files --ignored --exclude-standard -o --directory` which lists
 * untracked ignored files and directories (directories suffixed with `/`).
 *
 * @param workspace - Absolute path to the source workspace.
 * @returns Array of relative paths to ignored entries.
 */
export const discoverIgnoredEntries = (
  workspace: string,
): Effect.Effect<string[], FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["git", "ls-files", "--ignored", "--exclude-standard", "-o", "--directory"],
        {
          stdout: "pipe",
          stderr: "pipe",
          cwd: workspace,
        },
      )

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        throw { stderr, exitCode }
      }

      return stdout
        .trim()
        .split("\n")
        .map((entry) => entry.replace(/\/$/, "")) // strip trailing slash from directories
        .filter((entry) => entry.length > 0)
    },
    catch: (error) => {
      if (error && typeof error === "object" && "stderr" in error) {
        const e = error as { stderr: string; exitCode: number }
        return new FatalError({
          command: "git ls-files --ignored --exclude-standard -o --directory",
          message: e.stderr.trim() || `exited with code ${e.exitCode}`,
        })
      }
      return new FatalError({
        command: "git ls-files --ignored --exclude-standard -o --directory",
        message: `Failed to discover ignored entries: ${error}`,
      })
    },
  })

// ---------------------------------------------------------------------------
// .worktreeinclude parsing
// ---------------------------------------------------------------------------

/**
 * Read and parse a `.worktreeinclude` file from a workspace.
 *
 * The file is a newline-separated list of relative paths. Empty lines and
 * lines starting with `#` are ignored.
 *
 * @param workspace - Absolute path to the workspace containing the file.
 * @returns Array of relative paths, or `undefined` when the file does not exist.
 */
export const readWorktreeInclude = (
  workspace: string,
): string[] | undefined => {
  const filePath = path.join(workspace, WORKTREEINCLUDE_FILE)

  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const content = fs.readFileSync(filePath, "utf-8")
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

/**
 * Filter ignored entries against the `.worktreeinclude` allowlist.
 *
 * An entry matches if it equals an include entry exactly, or if it is
 * nested under an include entry (the include entry is a prefix with a
 * path separator boundary).
 *
 * @param entries - Discovered git-ignored entries (relative paths).
 * @param includes - Parsed `.worktreeinclude` entries.
 * @returns Filtered entries that match the allowlist.
 */
export const filterByWorktreeInclude = (
  entries: string[],
  includes: string[],
): string[] => {
  // Normalize includes: strip trailing slashes for consistent matching
  const normalized = includes.map((inc) => inc.replace(/\/$/, ""))

  return entries.filter((entry) =>
    normalized.some(
      (inc) =>
        entry === inc ||
        entry.startsWith(inc + "/") ||
        inc.startsWith(entry + "/"),
    ),
  )
}

// ---------------------------------------------------------------------------
// Copy result types
// ---------------------------------------------------------------------------

/**
 * Result of a copy-ignored operation.
 */
export interface CopyIgnoredResult {
  /** Number of entries successfully copied. */
  readonly copied: number
  /** Number of entries skipped due to copy failures. */
  readonly skipped: number
  /** Relative paths that failed to copy, with reasons. */
  readonly failures: ReadonlyArray<{ readonly entry: string; readonly reason: string }>
}

// ---------------------------------------------------------------------------
// Copy operation
// ---------------------------------------------------------------------------

/**
 * Copy a single entry (file or directory) from source to destination.
 * Uses recursive copy for directories. Overwrites existing entries.
 */
const copyEntry = (
  entry: string,
  source: string,
  destination: string,
): { ok: true } | { ok: false; reason: string } => {
  const srcPath = path.join(source, entry)
  const destPath = path.join(destination, entry)

  try {
    const stat = fs.lstatSync(srcPath)

    // Skip special entries: sockets, block/char devices, FIFOs
    if (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink()) {
      return { ok: false, reason: "unsupported file type (socket, device, or FIFO)" }
    }

    // Ensure parent directory exists at destination
    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    if (stat.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true })
    } else if (stat.isSymbolicLink()) {
      // Copy symlinks: read target and recreate
      const linkTarget = fs.readlinkSync(srcPath)
      try {
        fs.unlinkSync(destPath)
      } catch {
        // Destination may not exist, that's fine
      }
      fs.symlinkSync(linkTarget, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

// ---------------------------------------------------------------------------
// Main primitive
// ---------------------------------------------------------------------------

/**
 * Copy git-ignored entries from a source workspace to a destination workspace.
 *
 * Behavior:
 * - Discovers git-ignored entries from the source workspace.
 * - When `.worktreeinclude` exists in the source, only listed entries are copied.
 * - When `.worktreeinclude` is absent, all discovered ignored entries are copied.
 * - Destination files are overwritten unconditionally.
 * - Non-copyable entries are skipped and reported in the result.
 * - If any entries fail to copy, the operation fails with FatalError.
 *
 * @param source - Absolute path to the source workspace.
 * @param destination - Absolute path to the destination workspace.
 */
export const copyIgnored = (
  source: string,
  destination: string,
): Effect.Effect<CopyIgnoredResult, FatalError> =>
  Effect.gen(function* () {
    // Discover all git-ignored entries in the source workspace
    const allIgnored = yield* discoverIgnoredEntries(source)

    if (allIgnored.length === 0) {
      yield* Effect.logInfo("No git-ignored entries found in source workspace.")
      return { copied: 0, skipped: 0, failures: [] } as CopyIgnoredResult
    }

    // Apply .worktreeinclude narrowing if present
    const includes = readWorktreeInclude(source)
    const entriesToCopy =
      includes !== undefined
        ? filterByWorktreeInclude(allIgnored, includes)
        : allIgnored

    if (includes !== undefined) {
      yield* Effect.logInfo(
        `Applying .worktreeinclude filter: ${entriesToCopy.length} of ${allIgnored.length} ignored entries selected.`,
      )
    } else {
      yield* Effect.logInfo(
        `No .worktreeinclude found — copying all ${entriesToCopy.length} git-ignored entries.`,
      )
    }

    if (entriesToCopy.length === 0) {
      yield* Effect.logInfo("No entries to copy after filtering.")
      return { copied: 0, skipped: 0, failures: [] } as CopyIgnoredResult
    }

    // Copy entries
    let copied = 0
    const failures: Array<{ entry: string; reason: string }> = []

    for (const entry of entriesToCopy) {
      const result = copyEntry(entry, source, destination)
      if (result.ok) {
        copied++
      } else {
        failures.push({ entry, reason: result.reason })
      }
    }

    if (failures.length > 0) {
      yield* Effect.logWarning(
        `Failed to copy ${failures.length} entries: ${failures.map((f) => `${f.entry} (${f.reason})`).join(", ")}`,
      )
      return yield* Effect.fail(
        new FatalError({
          command: "copyIgnored",
          message: `Failed to copy ${failures.length} of ${entriesToCopy.length} entries: ${failures.map((f) => f.entry).join(", ")}`,
        }),
      )
    }

    yield* Effect.logInfo(`Copied ${copied} git-ignored entries to destination workspace.`)
    return { copied, skipped: 0, failures: [] } as CopyIgnoredResult
  }).pipe(
    Effect.annotateLogs({ source, destination }),
    Effect.withLogSpan("copy-ignored"),
  )
