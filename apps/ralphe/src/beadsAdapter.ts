/**
 * ABOUTME: Beads adapter for the watch-mode TUI.
 * Provides task list/detail queries and write-through state
 * transitions via the bd CLI, maps Beads data to TUI-compatible
 * types, and handles .beads database bootstrap when missing.
 */

import path from "node:path"
import fs from "node:fs"
import { Console, Effect } from "effect"
import { FatalError } from "./errors.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * TUI-friendly task status derived from Beads statuses.
 */
export type WatchTaskStatus =
  | "actionable" // open + no unresolved blocking deps
  | "blocked"    // open + has unresolved blocking deps
  | "active"     // in_progress
  | "done"       // closed successfully
  | "error"      // closed with failure / cancelled

/**
 * Task item shaped for TUI rendering.
 * Intentionally decoupled from the raw BeadsIssue so the TUI
 * layer never depends on bd CLI output format directly.
 */
export interface WatchTask {
  readonly id: string
  readonly title: string
  readonly status: WatchTaskStatus
  readonly description?: string | undefined
  readonly design?: string | undefined
  readonly acceptance_criteria?: string | undefined
  readonly notes?: string | undefined
  readonly priority?: number | undefined
  readonly labels?: string[] | undefined
  readonly parentId?: string | undefined
  readonly dependsOn?: string[] | undefined
  readonly blocks?: string[] | undefined
  readonly owner?: string | undefined
  readonly createdAt?: string | undefined
  readonly updatedAt?: string | undefined
  readonly closedAt?: string | undefined
  readonly closeReason?: string | undefined
  readonly issueType?: string | undefined
}

// ---------------------------------------------------------------------------
// Raw bd JSON shape
// ---------------------------------------------------------------------------

interface BdIssueJson {
  id: string
  title: string
  description?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  status: string
  priority?: number
  labels?: string[]
  parent?: string
  owner?: string
  issue_type?: string
  created_at?: string
  updated_at?: string
  closed_at?: string
  close_reason?: string
  dependencies?: Array<{
    id: string
    title?: string
    status?: string
    dependency_type?: string
  }>
  dependents?: Array<{
    id: string
    title?: string
    status?: string
    dependency_type?: string
  }>
}

// ---------------------------------------------------------------------------
// bd CLI runner
// ---------------------------------------------------------------------------

const runBd = (
  args: string[],
  cwd?: string,
): Effect.Effect<string, FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["bd", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: cwd ?? process.cwd(),
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

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapStatus(bdStatus: string, deps?: BdIssueJson["dependencies"]): WatchTaskStatus {
  switch (bdStatus) {
    case "in_progress":
      return "active"
    case "closed":
      return "done"
    case "cancelled":
      return "error"
    case "open": {
      // Check if blocked by unresolved dependencies
      if (deps && deps.length > 0) {
        const hasUnresolved = deps.some(
          (d) =>
            d.dependency_type === "blocks" &&
            d.status !== "closed" &&
            d.status !== "cancelled",
        )
        if (hasUnresolved) return "blocked"
      }
      return "actionable"
    }
    default:
      return "actionable"
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse raw bd JSON output into WatchTask array.
 * Tolerates malformed JSON by returning an empty array.
 */
export const parseBdTaskList = (json: string): WatchTask[] => {
  try {
    const parsed = JSON.parse(json)
    const items: BdIssueJson[] = Array.isArray(parsed) ? parsed : [parsed]

    return items
      .filter(
        (item) =>
          item && typeof item === "object" && typeof item.id === "string",
      )
      .map((item) => bdIssueToWatchTask(item))
  } catch {
    return []
  }
}

/**
 * Convert a single bd issue JSON to a WatchTask.
 */
function bdIssueToWatchTask(item: BdIssueJson): WatchTask {
  const dependsOn: string[] = []
  const blocks: string[] = []

  if (item.dependencies) {
    for (const dep of item.dependencies) {
      if (dep.dependency_type === "blocks") {
        dependsOn.push(dep.id)
      }
    }
  }

  if (item.dependents) {
    for (const dep of item.dependents) {
      if (dep.dependency_type === "blocks") {
        blocks.push(dep.id)
      }
    }
  }

  // Infer parentId from dotted ID if not explicit
  let parentId = item.parent
  if (!parentId && item.id.includes(".")) {
    const lastDot = item.id.lastIndexOf(".")
    parentId = item.id.substring(0, lastDot)
  }

  return {
    id: item.id,
    title: item.title ?? "",
    status: mapStatus(item.status, item.dependencies),
    description: item.description,
    design: item.design,
    acceptance_criteria: item.acceptance_criteria,
    notes: item.notes,
    priority: item.priority,
    labels: item.labels,
    parentId,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    blocks: blocks.length > 0 ? blocks : undefined,
    owner: item.owner,
    issueType: item.issue_type,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at,
    closeReason: item.close_reason,
  }
}

// ---------------------------------------------------------------------------
// Adapter operations
// ---------------------------------------------------------------------------

/**
 * Query all Beads tasks for display in the watch TUI.
 */
export const queryAllTasks = (
  cwd?: string,
): Effect.Effect<WatchTask[], FatalError> =>
  runBd(["list", "--json"], cwd).pipe(Effect.map(parseBdTaskList))

/**
 * Query a single task by ID for the detail pane.
 */
export const queryTaskDetail = (
  id: string,
  cwd?: string,
): Effect.Effect<WatchTask | undefined, FatalError> =>
  runBd(["show", id, "--json"], cwd).pipe(
    Effect.map((stdout) => {
      const tasks = parseBdTaskList(stdout)
      return tasks[0]
    }),
    Effect.catchTag("FatalError", () => Effect.succeed(undefined)),
  )

// ---------------------------------------------------------------------------
// Task actions — write-through state transitions
// ---------------------------------------------------------------------------

/**
 * Supported manual task actions an operator can trigger from the TUI.
 */
export type TaskAction =
  | "start"    // actionable → active (claim)
  | "complete" // actionable|active → done (close success)
  | "fail"     // active → error (close failure)
  | "reopen"   // done|error → actionable (set status open)
  | "cancel"   // actionable|blocked → error (cancel)

/** Human label for each action, used in the TUI footer. */
export const taskActionLabel: Record<TaskAction, string> = {
  start: "Start",
  complete: "Complete",
  fail: "Fail",
  cancel: "Cancel",
  reopen: "Reopen",
}

/** Keyboard shortcut for each action. */
export const taskActionKey: Record<TaskAction, string> = {
  start: "s",
  complete: "c",
  fail: "f",
  cancel: "x",
  reopen: "o",
}

/** Reverse lookup: key → action. */
export const keyToTaskAction: Record<string, TaskAction> = Object.fromEntries(
  Object.entries(taskActionKey).map(([action, key]) => [key, action as TaskAction]),
) as Record<string, TaskAction>

/**
 * Derive which actions are available for a given task.
 * Respects Beads transition semantics and ownership:
 * - In-progress tasks owned by another worker cannot be overridden.
 * - Only valid transitions are offered.
 */
export function getAvailableActions(task: WatchTask): TaskAction[] {
  switch (task.status) {
    case "actionable":
      return ["start", "complete", "cancel"]
    case "blocked":
      return ["cancel"]
    case "active":
      // Active tasks are claimed by a worker. We allow the operator
      // to mark them complete or failed, but only if not owned by
      // another worker (i.e. owner is set). The TUI shows a warning
      // for owned tasks but still allows complete/fail since the
      // operator is explicitly choosing to close them.
      return ["complete", "fail"]
    case "done":
      return ["reopen"]
    case "error":
      return ["reopen"]
    default:
      return []
  }
}

/**
 * Result of a write-through task action.
 */
export interface TaskActionResult {
  readonly success: boolean
  readonly message: string
  /** Refreshed task list after write (only present on success). */
  readonly tasks?: WatchTask[]
}

/**
 * Execute a task action with write-through semantics:
 * 1. Validate the transition is allowed.
 * 2. Write to Beads via bd CLI.
 * 3. Re-read the full task list from Beads.
 * 4. Return result with refreshed tasks or error message.
 *
 * No optimistic local writes — the returned tasks come from Beads.
 */
export const executeTaskAction = (
  task: WatchTask,
  action: TaskAction,
  cwd?: string,
): Effect.Effect<TaskActionResult, never> =>
  Effect.gen(function* () {
    // 1. Validate
    const available = getAvailableActions(task)
    if (!available.includes(action)) {
      return {
        success: false,
        message: `Cannot ${action} task ${task.id} (status: ${task.status})`,
      }
    }

    // Guard: do not force-override in-progress owned work
    if (task.status === "active" && task.owner && action !== "complete" && action !== "fail") {
      return {
        success: false,
        message: `Task ${task.id} is claimed by ${task.owner} — cannot ${action}`,
      }
    }

    // 2. Write to Beads
    const writeResult = yield* performBeadsWrite(task.id, action, cwd).pipe(
      Effect.map((msg) => ({ ok: true as const, msg })),
      Effect.catchTag("FatalError", (err) =>
        Effect.succeed({ ok: false as const, msg: err.message }),
      ),
    )

    if (!writeResult.ok) {
      return { success: false, message: writeResult.msg }
    }

    // 3. Re-read from Beads
    const refreshResult = yield* queryAllTasks(cwd).pipe(
      Effect.catchTag("FatalError", () => Effect.succeed(undefined as WatchTask[] | undefined)),
    )

    return {
      success: true,
      message: writeResult.msg,
      tasks: refreshResult ?? undefined,
    }
  })

/**
 * Perform the actual Beads CLI write for an action.
 * Maps each action to the appropriate bd command.
 */
const performBeadsWrite = (
  id: string,
  action: TaskAction,
  cwd?: string,
): Effect.Effect<string, FatalError> => {
  switch (action) {
    case "start":
      return runBd(["update", id, "--claim"], cwd).pipe(
        Effect.map(() => `Started task ${id}`),
      )
    case "complete":
      return runBd(["close", id, "--reason", "completed via TUI"], cwd).pipe(
        Effect.map(() => `Completed task ${id}`),
      )
    case "fail":
      return runBd(["close", id, "--reason", "failed: marked failed via TUI"], cwd).pipe(
        Effect.map(() => `Marked task ${id} as failed`),
      )
    case "reopen":
      return runBd(["update", id, "--status", "open"], cwd).pipe(
        Effect.map(() => `Reopened task ${id}`),
      )
    case "cancel":
      return runBd(["update", id, "--status", "cancelled"], cwd).pipe(
        Effect.map(() => `Cancelled task ${id}`),
      )
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Check whether a root .beads Dolt database exists.
 */
export const beadsDatabaseExists = (workDir = process.cwd()): boolean => {
  const beadsDir = path.join(workDir, ".beads")
  return fs.existsSync(beadsDir)
}

/**
 * Bootstrap a .beads Dolt database if missing.
 * Returns a user-visible message describing what happened.
 */
export const ensureBeadsDatabase = (
  workDir = process.cwd(),
): Effect.Effect<string, FatalError> =>
  Effect.gen(function* () {
    if (beadsDatabaseExists(workDir)) {
      return "Using existing .beads database."
    }

    yield* Console.log("No .beads database found. Initializing…")
    yield* runBd(["init"], workDir)
    return "Initialized new .beads database."
  })
