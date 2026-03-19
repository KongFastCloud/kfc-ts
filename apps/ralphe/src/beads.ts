import { Console, Effect } from "effect"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BeadsIssue {
  readonly id: string
  readonly title: string
  readonly description?: string | undefined
  readonly design?: string | undefined
  readonly acceptance_criteria?: string | undefined
  readonly notes?: string | undefined
}

export interface BeadsMetadata {
  readonly engine: "claude" | "codex"
  readonly resumeToken?: string | undefined
  readonly workerId: string
  readonly timestamp: string
  /** ISO-8601 timestamp captured when the latest run begins. */
  readonly startedAt?: string | undefined
  /** ISO-8601 timestamp captured when the latest run finishes (done or error). */
  readonly finishedAt?: string | undefined
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build execution prompt from issue content fields.
 * Fields are included in order: title, description, design, acceptance_criteria, notes.
 * Missing fields are omitted.
 */
export const buildPromptFromIssue = (issue: BeadsIssue): string => {
  const sections: string[] = []

  sections.push(issue.title)

  if (issue.description) {
    sections.push(`\n## Description\n${issue.description}`)
  }
  if (issue.design) {
    sections.push(`\n## Design\n${issue.design}`)
  }
  if (issue.acceptance_criteria) {
    sections.push(`\n## Acceptance Criteria\n${issue.acceptance_criteria}`)
  }
  if (issue.notes) {
    sections.push(`\n## Notes\n${issue.notes}`)
  }

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// bd CLI helpers
// ---------------------------------------------------------------------------

const runBd = (
  args: string[],
): Effect.Effect<string, FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["bd", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        throw { stderr, exitCode }
      }

      return stdout
    },
    catch: (error) => {
      if (error && typeof error === "object" && "stderr" in error) {
        const e = error as { stderr: string; exitCode: number }
        return new FatalError({
          command: `bd ${args.join(" ")}`,
          message: e.stderr.trim() || `exited with code ${e.exitCode}`,
        })
      }
      return new FatalError({
        command: `bd ${args.join(" ")}`,
        message: `Failed to run bd: ${error}`,
      })
    },
  })

type JsonRecord = Record<string, unknown>

const parseIssueJson = (json: string): BeadsIssue[] => {
  try {
    const parsed = JSON.parse(json)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items
      .filter((item: JsonRecord) => item && typeof item === "object" && typeof item.id === "string")
      .map((item: JsonRecord) => ({
        id: item.id as string,
        title: (item.title as string) ?? "",
        description: item.description as string | undefined,
        design: item.design as string | undefined,
        acceptance_criteria: item.acceptance_criteria as string | undefined,
        notes: item.notes as string | undefined,
      }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Beads operations
// ---------------------------------------------------------------------------

/**
 * Query Beads for ready tasks.
 */
export const queryReady = (): Effect.Effect<BeadsIssue[], FatalError> =>
  runBd(["ready", "--json"]).pipe(
    Effect.map(parseIssueJson),
  )

/**
 * Atomically claim a task by ID.
 * Returns true if claim succeeded, false if already claimed by another worker.
 */
export const claimTask = (
  id: string,
): Effect.Effect<boolean, FatalError> =>
  runBd(["update", id, "--claim"]).pipe(
    Effect.map(() => true),
    Effect.catchTag("FatalError", (err) => {
      // Claim contention: another worker already claimed it
      if (err.message.includes("already claimed") || err.message.includes("claim")) {
        return Effect.succeed(false)
      }
      return Effect.fail(err)
    }),
  )

/**
 * Close a task with a success reason.
 */
export const closeTaskSuccess = (
  id: string,
  reason = "completed successfully",
): Effect.Effect<void, FatalError> =>
  runBd(["close", id, "--reason", reason]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Close a task with a failure reason.
 * The reason includes a failure keyword to preserve Beads failure semantics.
 */
export const closeTaskFailure = (
  id: string,
  reason: string,
): Effect.Effect<void, FatalError> =>
  runBd(["close", id, "--reason", `failed: ${reason}`]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Add a label to a task.
 */
export const addLabel = (
  id: string,
  label: string,
): Effect.Effect<void, FatalError> =>
  runBd(["update", id, "--add-label", label]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Remove a label from a task.
 */
export const removeLabel = (
  id: string,
  label: string,
): Effect.Effect<void, FatalError> =>
  runBd(["update", id, "--remove-label", label]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Mark a task as having exhausted all retries.
 * Keeps the task open, removes the "ready" label so it is no longer
 * automatically eligible, and adds the "error" label for operator visibility.
 * The failure reason is preserved in metadata for later investigation.
 */
export const markTaskExhaustedFailure = (
  id: string,
  reason: string,
  metadata: BeadsMetadata,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    // Persist failure context in metadata (includes resume token for manual retry)
    yield* writeMetadata(id, metadata)
    // Remove automatic eligibility
    yield* removeLabel(id, "ready")
    // Apply the error label so operators and TUI can identify the failure
    yield* addLabel(id, "error")
    // Preserve the failure reason in the task notes for human investigation
    yield* runBd(["update", id, "--append-note", `Exhausted failure: ${reason}`]).pipe(
      Effect.map(() => undefined),
    )
  })

/**
 * Write execution metadata to a task under the `ralphe` namespace.
 */
export const writeMetadata = (
  id: string,
  metadata: BeadsMetadata,
): Effect.Effect<void, FatalError> =>
  runBd(["update", id, "--set-metadata", `ralphe=${JSON.stringify(metadata)}`]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Query for stale in-progress tasks claimed by a specific worker.
 * Used for startup recovery.
 */
export const queryStaleClaimed = (
  workerId: string,
): Effect.Effect<BeadsIssue[], FatalError> =>
  runBd(["list", "--status", "in_progress", "--json"]).pipe(
    Effect.map((stdout) => {
      const issues = parseIssueJson(stdout)
      // Filter to issues claimed by this worker via metadata
      return issues.filter((issue) => {
        // We parse the raw JSON again to check metadata
        try {
          const parsed = JSON.parse(stdout)
          const items = Array.isArray(parsed) ? parsed : [parsed]
          const item = items.find((i: JsonRecord) => i.id === issue.id)
          const ralpheMetadata = (item?.metadata as JsonRecord)?.ralphe as JsonRecord | undefined
          return ralpheMetadata?.workerId === workerId
        } catch {
          return false
        }
      })
    }),
  )

/**
 * Recover stale claimed tasks by closing them as failures.
 */
export const recoverStaleTasks = (
  workerId: string,
): Effect.Effect<number, FatalError> =>
  Effect.gen(function* () {
    const stale = yield* queryStaleClaimed(workerId)

    for (const issue of stale) {
      yield* Console.log(`Recovering stale task: ${issue.id} (${issue.title})`)
      yield* writeMetadata(issue.id, {
        engine: "claude",
        workerId,
        timestamp: new Date().toISOString(),
      })
      yield* closeTaskFailure(issue.id, "worker crashed — recovered on startup")
    }

    return stale.length
  })
