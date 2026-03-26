import { Effect } from "effect"
import { FatalError } from "./errors.js"
import { removeEpicWorktree, type EpicWorktreeCleanupResult } from "./epicWorktree.js"

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
  /** Parent issue ID (epic membership). */
  readonly parentId?: string | undefined
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
  /** Error message when the task exhausted all retries. */
  readonly error?: string | undefined
  /** Canonical epic branch name stored in the ralphe metadata namespace. */
  readonly branch?: string | undefined
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

type RalpheMetadataRecord = Partial<BeadsMetadata> & {
  readonly branch?: string | undefined
}

const parseRalpheMetadata = (raw: unknown): RalpheMetadataRecord | undefined => {
  if (raw == null) return undefined

  const parsed =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown
          } catch {
            return undefined
          }
        })()
      : raw

  if (!parsed || typeof parsed !== "object") {
    return undefined
  }

  const obj = parsed as Record<string, unknown>
  return {
    engine: obj.engine === "codex" ? "codex" : obj.engine === "claude" ? "claude" : undefined,
    workerId: typeof obj.workerId === "string" ? obj.workerId : undefined,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : undefined,
    resumeToken: typeof obj.resumeToken === "string" ? obj.resumeToken : undefined,
    startedAt: typeof obj.startedAt === "string" ? obj.startedAt : undefined,
    finishedAt: typeof obj.finishedAt === "string" ? obj.finishedAt : undefined,
    error: typeof obj.error === "string" ? obj.error : undefined,
    branch: typeof obj.branch === "string" ? obj.branch : undefined,
  }
}

const parseIssueJson = (json: string): BeadsIssue[] => {
  try {
    const parsed = JSON.parse(json)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items
      .filter((item: JsonRecord) => item && typeof item === "object" && typeof item.id === "string")
      .map((item: JsonRecord) => {
        // Infer parentId from explicit field or dotted ID notation
        let parentId = item.parent as string | undefined
        const id = item.id as string
        if (!parentId && id.includes(".")) {
          const lastDot = id.lastIndexOf(".")
          parentId = id.substring(0, lastDot)
        }
        return {
          id,
          title: (item.title as string) ?? "",
          description: item.description as string | undefined,
          design: item.design as string | undefined,
          acceptance_criteria: item.acceptance_criteria as string | undefined,
          notes: item.notes as string | undefined,
          parentId,
        }
      })
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
 * Also removes the `error` label so stale failure state does not persist
 * on successfully completed tasks.
 */
export const closeTaskSuccess = (
  id: string,
  reason = "completed successfully",
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    yield* removeLabel(id, "error")
    yield* runBd(["close", id, "--reason", reason])
  })

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
 * Mark a task as ready by adding the `ready` label.
 * This is a label-only operation — it does not change Beads lifecycle state.
 * Used for manual error-to-ready recovery and promoting non-done issues
 * back into the automatic pickup queue.
 *
 * The `error` label is intentionally preserved so that downstream consumers
 * (e.g. the agent) can detect that this is a retry and inspect the previous
 * failure context. The error label is cleared on successful completion.
 */
export const markTaskReady = (
  id: string,
  currentLabels: string[],
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    // Remove every existing label except error — error is preserved so the
    // agent knows this is a retry and can read the previous failure context.
    for (const label of currentLabels) {
      if (label !== "error") {
        yield* removeLabel(id, label)
      }
    }
    // Clear stale assignee so the task can be re-claimed by a worker
    yield* clearAssignee(id)
    // Apply the ready label
    yield* addLabel(id, "ready")
  })

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
    // Ensure the task is open so the TUI derives error status correctly
    yield* reopenTask(id)
    // Persist failure context in metadata (includes resume token for manual retry)
    yield* writeMetadata(id, { ...metadata, error: reason })
    // Remove automatic eligibility
    yield* removeLabel(id, "ready")
    // Apply the error label so operators and TUI can identify the failure
    yield* addLabel(id, "error")
  })

/**
 * Read execution metadata from a task's `ralphe` namespace.
 * Returns undefined when the task has no ralphe metadata or it is unparseable.
 */
export const readMetadata = (
  id: string,
): Effect.Effect<BeadsMetadata | undefined, FatalError> =>
  runBd(["show", id, "--json"]).pipe(
    Effect.map((stdout) => {
      try {
        const parsed = JSON.parse(stdout)
        const item = Array.isArray(parsed) ? parsed[0] : parsed
        const obj = parseRalpheMetadata(item?.metadata?.ralphe)
        if (!obj) return undefined

        return {
          engine: obj.engine ?? "claude",
          workerId: obj.workerId ?? "",
          timestamp: obj.timestamp ?? "",
          resumeToken: typeof obj.resumeToken === "string" ? obj.resumeToken : undefined,
          startedAt: typeof obj.startedAt === "string" ? obj.startedAt : undefined,
          finishedAt: typeof obj.finishedAt === "string" ? obj.finishedAt : undefined,
          error: typeof obj.error === "string" ? obj.error : undefined,
        } as BeadsMetadata
      } catch {
        return undefined
      }
    }),
  )

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

const readRalpheMetadataRecord = (
  id: string,
): Effect.Effect<RalpheMetadataRecord | undefined, FatalError> =>
  runBd(["show", id, "--json"]).pipe(
    Effect.map((stdout) => {
      try {
        const parsed = JSON.parse(stdout)
        const item = Array.isArray(parsed) ? parsed[0] : parsed
        return parseRalpheMetadata(item?.metadata?.ralphe)
      } catch {
        return undefined
      }
    }),
  )

const writeRalpheMetadataRecord = (
  id: string,
  metadata: RalpheMetadataRecord,
): Effect.Effect<void, FatalError> =>
  runBd(["update", id, "--set-metadata", `ralphe=${JSON.stringify(metadata)}`]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Persist the canonical branch owned by an epic into the `ralphe` metadata
 * namespace without discarding any existing metadata fields.
 */
export const setEpicBranchMetadata = (
  id: string,
  branch: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    const existing = yield* readRalpheMetadataRecord(id)
    yield* writeRalpheMetadataRecord(id, {
      ...existing,
      branch,
    })
  })

/**
 * Reopen a task by setting its Beads status back to `open`.
 * Used during startup recovery to move stale `in_progress` issues out of active state.
 */
export const reopenTask = (
  id: string,
): Effect.Effect<void, FatalError> =>
  runBd(["update", id, "--status", "open"]).pipe(
    Effect.map(() => undefined),
  )

/**
 * Clear the assignee on a task so no stale claim residue remains.
 * Used during startup recovery to remove ownership from recovered issues.
 */
export const clearAssignee = (
  id: string,
): Effect.Effect<void, FatalError> =>
  runBd(["update", id, "--assignee", ""]).pipe(
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
 * Query ALL stale in-progress tasks regardless of which worker originally
 * claimed them. Used for global startup recovery so that orphaned tasks
 * from any crashed worker are cleaned up.
 */
export const queryAllStaleInProgress = (): Effect.Effect<BeadsIssue[], FatalError> =>
  runBd(["list", "--status", "in_progress", "--json"]).pipe(
    Effect.map(parseIssueJson),
  )

/**
 * Add a comment to a task via `bd comments add`.
 * Fire-and-forget: a failed comment write logs a warning instead of propagating.
 */
export const addComment = (
  id: string,
  text: string,
): Effect.Effect<void, never> =>
  runBd(["comments", "add", id, text]).pipe(
    Effect.map(() => undefined),
    Effect.catchTag("FatalError", (err) =>
      Effect.logWarning(`Failed to write comment on ${id}: ${err.message}`),
    ),
  )

// ---------------------------------------------------------------------------
// Epic lifecycle
// ---------------------------------------------------------------------------

/**
 * Close an epic and trigger automatic worktree cleanup.
 *
 * This is the canonical epic closure operation. It:
 * 1. Closes the epic issue in Beads with a reason.
 * 2. Removes the epic's worktree (force-removes even if dirty).
 * 3. Emits a warning if the worktree was dirty at cleanup time.
 *
 * Cleanup is immediate and does not introduce a second cleanup-state machine.
 * If worktree cleanup fails, the epic is still closed but the error is
 * propagated so the caller can surface it operationally.
 */
export const closeEpic = (
  id: string,
  reason = "epic closed",
  cleanupWorktree: (epicId: string) => Effect.Effect<EpicWorktreeCleanupResult, FatalError> = removeEpicWorktree,
): Effect.Effect<EpicWorktreeCleanupResult, FatalError> =>
  Effect.gen(function* () {
    // Close the epic issue in Beads
    yield* runBd(["close", id, "--reason", reason])
    yield* Effect.logInfo(`Epic ${id} closed: ${reason}`)

    // Trigger worktree cleanup
    const cleanupResult = yield* cleanupWorktree(id)

    if (cleanupResult.removed && cleanupResult.wasDirty) {
      yield* Effect.logWarning(
        `Epic ${id} worktree was dirty at cleanup. ` +
        `Uncommitted changes at ${cleanupResult.worktreePath ?? "unknown path"} were discarded.`,
      )
    }

    return cleanupResult
  }).pipe(
    Effect.annotateLogs({ epicId: id }),
  )

/**
 * Recover ALL stale in-progress tasks on startup.
 *
 * Recovery is global: every in_progress issue is recovered regardless of
 * which worker originally claimed it. Each recovered task is transitioned
 * to open + error state via {@link markTaskExhaustedFailure} so it remains
 * visible to operators but is no longer automatically picked up.
 */
export const recoverStaleTasks = (
  workerId: string,
): Effect.Effect<number, FatalError> =>
  Effect.gen(function* () {
    const stale = yield* queryAllStaleInProgress()

    for (const issue of stale) {
      yield* Effect.logInfo(`Recovering stale task: ${issue.id}`)
      // Clear stale assignee/claim residue
      yield* clearAssignee(issue.id)
      // Apply error state: remove ready label, add error label, persist metadata & notes
      const now = new Date().toISOString()
      yield* markTaskExhaustedFailure(
        issue.id,
        "worker crashed — recovered on startup",
        {
          engine: "claude",
          workerId,
          timestamp: now,
          finishedAt: now,
        },
      )
    }

    return stale.length
  })
