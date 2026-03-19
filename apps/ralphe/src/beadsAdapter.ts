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
import type { BeadsIssue } from "./beads.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Ralphe status derived from Beads status, labels, and dependency state.
 *
 * Mapping (see /prd/ralphe-status-alignment.md):
 *  open + no ready + no error + no unresolved blockers → backlog
 *  open + ready   + no error + no unresolved blockers → actionable
 *  open + unresolved blocking dependencies            → blocked
 *  open + error label                                 → error
 *  in_progress                                        → active
 *  closed                                             → done
 */
export type WatchTaskStatus =
  | "backlog"    // open + no ready label + no error label + no unresolved blockers
  | "actionable" // open + ready label + no error label + no unresolved blockers
  | "blocked"    // open + unresolved blocking deps
  | "active"     // in_progress
  | "done"       // closed
  | "error"      // open + error label (exhausted retries), or cancelled

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
  /** ISO-8601 timestamp when the latest run started (from ralphe metadata). */
  readonly startedAt?: string | undefined
  /** ISO-8601 timestamp when the latest run finished (from ralphe metadata). */
  readonly finishedAt?: string | undefined
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
  metadata?: {
    ralphe?: {
      startedAt?: string
      finishedAt?: string
    } | string
  }
  dependencies?: Array<{
    id?: string
    depends_on_id?: string
    issue_id?: string
    title?: string
    status?: string
    dependency_type?: string
    type?: string
  }>
  dependents?: Array<{
    id?: string
    depends_on_id?: string
    issue_id?: string
    title?: string
    status?: string
    dependency_type?: string
    type?: string
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

function getDependencyId(
  dep: NonNullable<BdIssueJson["dependencies"]>[number],
): string | undefined {
  return dep.id ?? dep.depends_on_id
}

function getDependencyType(
  dep: NonNullable<BdIssueJson["dependencies"]>[number],
): string | undefined {
  return dep.dependency_type ?? dep.type
}

function mapStatus(
  bdStatus: string,
  deps?: BdIssueJson["dependencies"],
  labels?: string[],
  statusById?: Map<string, string>,
): WatchTaskStatus {
  switch (bdStatus) {
    case "in_progress":
      return "active"
    case "closed":
      return "done"
    case "cancelled":
      return "error"
    case "open": {
      // Error label takes priority — task exhausted all retries
      if (labels && labels.includes("error")) return "error"
      // Check if blocked by unresolved dependencies
      if (deps && deps.length > 0) {
        const hasUnresolved = deps.some(
          (d) => {
            if (getDependencyType(d) !== "blocks") return false

            const dependencyStatus = d.status ?? (
              getDependencyId(d)
                ? statusById?.get(getDependencyId(d)!)
                : undefined
            )

            return dependencyStatus !== "closed" && dependencyStatus !== "cancelled"
          },
        )
        if (hasUnresolved) return "blocked"
      }
      // Ready label distinguishes actionable from backlog
      if (labels && labels.includes("ready")) return "actionable"
      return "backlog"
    }
    default:
      return "backlog"
  }
}

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

interface RalpheTimingMeta {
  readonly startedAt?: string | undefined
  readonly finishedAt?: string | undefined
}

/**
 * Normalize the ralphe metadata payload into a typed timing object.
 * Beads may return the value as either a structured object or a
 * serialized JSON string — this helper handles both representations.
 * Returns undefined when the payload is missing or unparseable.
 */
function normalizeRalpheMeta(
  raw: BdIssueJson["metadata"],
): RalpheTimingMeta | undefined {
  const ralphe = raw?.ralphe
  if (ralphe == null) return undefined

  // Already a structured object
  if (typeof ralphe === "object") {
    return {
      startedAt: typeof ralphe.startedAt === "string" ? ralphe.startedAt : undefined,
      finishedAt: typeof ralphe.finishedAt === "string" ? ralphe.finishedAt : undefined,
    }
  }

  // Serialized JSON string — attempt to parse
  if (typeof ralphe === "string") {
    try {
      const parsed: unknown = JSON.parse(ralphe)
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>
        return {
          startedAt: typeof obj.startedAt === "string" ? obj.startedAt : undefined,
          finishedAt: typeof obj.finishedAt === "string" ? obj.finishedAt : undefined,
        }
      }
    } catch {
      // Unparseable string — fall through
    }
  }

  return undefined
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
    const items = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (item): item is BdIssueJson =>
        item && typeof item === "object" && typeof item.id === "string",
    )

    const statusById = new Map(
      items.map((item) => [item.id, item.status]),
    )

    return items.map((item) => bdIssueToWatchTask(item, statusById))
  } catch {
    return []
  }
}

/**
 * Convert a single bd issue JSON to a WatchTask.
 */
function bdIssueToWatchTask(
  item: BdIssueJson,
  statusById?: Map<string, string>,
): WatchTask {
  const dependsOn: string[] = []
  const blocks: string[] = []

  if (item.dependencies) {
    for (const dep of item.dependencies) {
      const depId = getDependencyId(dep)
      if (getDependencyType(dep) === "blocks" && depId) {
        dependsOn.push(depId)
      }
    }
  }

  if (item.dependents) {
    for (const dep of item.dependents) {
      const depId = getDependencyId(dep)
      if (getDependencyType(dep) === "blocks" && depId) {
        blocks.push(depId)
      }
    }
  }

  // Infer parentId from dotted ID if not explicit
  let parentId = item.parent
  if (!parentId && item.id.includes(".")) {
    const lastDot = item.id.lastIndexOf(".")
    parentId = item.id.substring(0, lastDot)
  }

  const timing = normalizeRalpheMeta(item.metadata)

  return {
    id: item.id,
    title: item.title ?? "",
    status: mapStatus(item.status, item.dependencies, item.labels, statusById),
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
    startedAt: timing?.startedAt,
    finishedAt: timing?.finishedAt,
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
  runBd(["list", "--json", "--all", "--limit", "0"], cwd).pipe(Effect.map(parseBdTaskList))

/**
 * Query only actionable tasks for the executor.
 * Uses the full task list with derived status to ensure only issues that are
 * open, ready-labeled, not errored, and not blocked by unresolved dependencies
 * are returned. This is the authoritative gate for automatic pickup.
 *
 * Note: this fetches all issues and filters client-side, which is heavier
 * than `bd ready --json` but guarantees correctness against the Ralphe
 * actionable definition (see /prd/ralphe-status-alignment.md).
 */
export const queryActionable = (
  cwd?: string,
): Effect.Effect<BeadsIssue[], FatalError> =>
  queryAllTasks(cwd).pipe(
    Effect.map((tasks) =>
      tasks
        .filter((t) => t.status === "actionable")
        .map((t): BeadsIssue => ({
          id: t.id,
          title: t.title,
          description: t.description,
          design: t.design,
          acceptance_criteria: t.acceptance_criteria,
          notes: t.notes,
        })),
    ),
  )

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
// Task actions
// ---------------------------------------------------------------------------

/**
 * Manual task action identifiers.
 */
export type TaskAction = "mark-ready"

/**
 * Non-done statuses eligible for the Mark Ready action.
 */
const MARK_READY_ELIGIBLE: ReadonlySet<WatchTaskStatus> = new Set([
  "backlog",
  "actionable",
  "blocked",
  "active",
  "error",
])

/**
 * Return available manual actions for a task.
 * Currently only "mark-ready" is supported, and only for non-done issues.
 */
export function getAvailableActions(task: WatchTask): TaskAction[] {
  if (MARK_READY_ELIGIBLE.has(task.status)) {
    return ["mark-ready"]
  }
  return []
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
