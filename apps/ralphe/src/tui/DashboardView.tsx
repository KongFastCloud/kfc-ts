/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Dashboard landing view for the watch TUI.
 * Renders a split layout with three panes:
 * - Top: Active tasks table (non-done, non-epic tasks) — primary operational pane
 * - Bottom-left: Epic pane — secondary focusable pane showing epic ID, title, and derived status
 * - Bottom-right: Done tasks table — completed tasks sorted by closedAt
 *
 * The active table shows a Ready checkmark when a task has the 'ready' label,
 * while the done table shows a compact Completed datetime instead.
 * Shared columns: ID, Title (clipped), Status, Duration.
 * The active table also shows Ready and Priority; the done table
 * replaces both with a wider Completed column.
 *
 * The epic pane shows: ID, Title, Status
 * (error | not_started | active | dirty | queued_for_deletion).
 * It always renders so the split layout remains stable even when no epics exist yet.
 */

import type { ReactNode } from "react"
import { useState, useEffect, useRef } from "react"
import type { BoxRenderable } from "@opentui/core"
import type { WatchTask, WatchTaskStatus } from "../beadsAdapter.js"
import type { EpicDisplayItem, EpicDisplayStatus } from "./epicStatus.js"
import { excludeEpicTasks } from "./epicStatus.js"
import { computeDayTotal, computeWeekTotal } from "./statsCompute.js"

// ---------------------------------------------------------------------------
// Theme (inline subset — matches WatchApp theme)
// ---------------------------------------------------------------------------

const colors = {
  bg: { primary: "#1a1b26", secondary: "#24283b", tertiary: "#2f3449", highlight: "#3d4259" },
  fg: { primary: "#c0caf5", secondary: "#a9b1d6", muted: "#565f89", dim: "#414868" },
  status: { success: "#9ece6a", warning: "#e0af68", error: "#f7768e", info: "#7aa2f7" },
  accent: { primary: "#7aa2f7", secondary: "#bb9af7", tertiary: "#7dcfff" },
  border: { normal: "#3d4259", active: "#7aa2f7", muted: "#2f3449" },
} as const

/**
 * Conservative slack so computed columns do not clip against pane borders.
 * Accounts for rounding differences between our integer math and the flex
 * engine's layout, plus breathing room for rounding drift in the 1:1 bottom-
 * row split and any sub-pixel-to-character rounding in OpenTUI.
 */
const WIDTH_SAFETY_MARGIN = 6

const taskStatusColor: Record<WatchTaskStatus, string> = {
  backlog: colors.fg.muted,
  queued: colors.status.success,
  active: colors.status.success,
  blocked: colors.status.error,
  done: colors.status.success,
  error: colors.status.error,
}

const taskStatusIndicator: Record<WatchTaskStatus, string> = {
  backlog: "·",
  queued: "○",
  active: "▶",
  blocked: "⊘",
  done: "✓",
  error: "✗",
}

const epicStatusColor: Record<EpicDisplayStatus, string> = {
  error: colors.status.error,
  not_started: colors.fg.muted,
  active: colors.status.info,
  dirty: colors.status.warning,
  queued_for_deletion: colors.status.warning,
}

const epicStatusIndicator: Record<EpicDisplayStatus, string> = {
  error: "✗",
  not_started: "·",
  active: "●",
  dirty: "△",
  queued_for_deletion: "◌",
}

// ---------------------------------------------------------------------------
// Column layout
// ---------------------------------------------------------------------------

/** Fixed column widths for the dashboard table. */
const COL = {
  id: 12,
  /** Visible separator gutter between ID and Title (e.g. " │ "). */
  idTitleSep: 3,
  status: 12,
  ready: 14,
  priority: 5,
  duration: 10,
  /** Width of the Completed column in the done table (ready 14 + priority 5 + separator 3). */
  completedDone: 22,
  /** Width of the epic status column. */
  epicStatus: 22,
  /** Title takes remaining space — computed dynamically. */
} as const

/** Separator string rendered between ID and Title columns. */
const ID_TITLE_SEP = " │ "

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return text.slice(0, max - 1) + "…"
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  return text + " ".repeat(width - text.length)
}

/**
 * Format an ID cell: right-pad the ID to the column width.
 * Exported for testing.
 */
export function formatIdCell(id: string): string {
  return pad(truncate(id, COL.id - 1), COL.id)
}

/** Table variant controls which fourth column is shown. */
type TableVariant = "active" | "done"

/**
 * Format an ISO-8601 timestamp into a compact local datetime string.
 * Example: "Mar 19 7:41 PM". Returns "—" when the input is missing or invalid.
 */
export function formatCompletedAt(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"

  const month = d.toLocaleString("en-US", { month: "short" })
  const day = d.getDate()
  // 12-hour time without leading zero
  let hours = d.getHours()
  const ampm = hours >= 12 ? "PM" : "AM"
  hours = hours % 12 || 12
  const minutes = d.getMinutes().toString().padStart(2, "0")

  return `${month} ${day} ${hours}:${minutes} ${ampm}`
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "12s", "3m 45s", "1h 23m", "2h 0m".
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return "—"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Compute the duration string for a dashboard row based on task status
 * and timing metadata.
 *
 * - active: live elapsed time from now - startedAt
 * - done / error: finishedAt - startedAt
 * - backlog / queued / blocked / incomplete metadata: "—"
 */
export function computeDuration(task: WatchTask): string {
  const { status, startedAt, finishedAt } = task

  // Statuses that never show duration
  if (status === "backlog" || status === "queued" || status === "blocked") {
    return "—"
  }

  // Need at least startedAt for any duration calculation
  if (!startedAt) return "—"

  const startMs = new Date(startedAt).getTime()
  if (Number.isNaN(startMs)) return "—"

  if (status === "active") {
    // Live elapsed time
    const elapsed = Date.now() - startMs
    return formatDuration(elapsed)
  }

  // done or error: need finishedAt
  if (!finishedAt) return "—"
  const endMs = new Date(finishedAt).getTime()
  if (Number.isNaN(endMs)) return "—"

  return formatDuration(endMs - startMs)
}

// ---------------------------------------------------------------------------
// Partitioning
// ---------------------------------------------------------------------------

/** Non-done statuses that appear in the top table. */
const NON_DONE_STATUSES: ReadonlySet<WatchTaskStatus> = new Set([
  "backlog",
  "queued",
  "blocked",
  "active",
  "error",
])

export interface DashboardPartition {
  active: WatchTask[]
  done: WatchTask[]
}

/**
 * Partition tasks into non-done (top table) and done (bottom table) buckets.
 * Preserves the original adapter/query ordering within each bucket.
 * Excludes epic-labeled tasks (they appear in the epic pane instead).
 */
export function partitionTasks(tasks: WatchTask[]): DashboardPartition {
  const nonEpicTasks = excludeEpicTasks(tasks)
  const active: WatchTask[] = []
  const done: WatchTask[] = []

  for (const task of nonEpicTasks) {
    if (task.status === "done") {
      done.push(task)
    } else if (NON_DONE_STATUSES.has(task.status)) {
      active.push(task)
    }
  }

  return { active, done }
}

/**
 * Sort done tasks by completion timestamp (closedAt) descending so newest
 * completions appear first. Tasks with missing or invalid closedAt fall to
 * the bottom, preserving their original relative order among themselves.
 */
export function sortDoneTasks(tasks: WatchTask[]): WatchTask[] {
  // Tag each task with its original index for stable ordering of invalid entries
  const tagged = tasks.map((task, index) => {
    const ts = task.closedAt ? new Date(task.closedAt).getTime() : NaN
    return { task, index, ts, valid: !Number.isNaN(ts) }
  })

  tagged.sort((a, b) => {
    // Valid timestamps come before invalid ones
    if (a.valid && !b.valid) return -1
    if (!a.valid && b.valid) return 1
    // Both valid: descending by timestamp
    if (a.valid && b.valid) return b.ts - a.ts
    // Both invalid: preserve original order
    return a.index - b.index
  })

  return tagged.map((t) => t.task)
}

// ---------------------------------------------------------------------------
// Section title
// ---------------------------------------------------------------------------

function DashboardSectionTitle({ title }: { title: string }): ReactNode {
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: colors.bg.primary,
      }}
    >
      <text>
        <span fg={colors.accent.primary}>{title}</span>
      </text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Table header
// ---------------------------------------------------------------------------

function DashboardTableHeader({ titleWidth, variant, completedWidth }: { titleWidth: number; variant: TableVariant; completedWidth?: number }): ReactNode {
  const isDone = variant === "done"
  const effectiveCompletedWidth = completedWidth ?? COL.completedDone
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: colors.bg.secondary,
      }}
    >
      <text>
        <span fg={colors.fg.dim}>{pad("ID", COL.id)}</span>
        <span fg={colors.border.normal}>{ID_TITLE_SEP}</span>
        <span fg={colors.fg.muted}>
          {pad("Title", titleWidth)}
          {pad("Status", COL.status)}
          {isDone
            ? pad("Completed", effectiveCompletedWidth)
            : `${pad("Ready", COL.ready)}${pad("Pri", COL.priority)}`}
          {pad("Duration", COL.duration)}
        </span>
      </text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

function DashboardRow({
  task,
  isSelected,
  titleWidth,
  variant,
  isMarkingReady,
  completedWidth,
}: {
  task: WatchTask
  isSelected: boolean
  titleWidth: number
  variant: TableVariant
  isMarkingReady?: boolean
  completedWidth?: number
}): ReactNode {
  const indicator = taskStatusIndicator[task.status]
  const sColor = taskStatusColor[task.status]
  const isDimmed = task.status === "done" || task.status === "error"
  const effectiveDimmed = isDimmed && !isSelected

  const idStr = formatIdCell(task.id)
  const titleStr = titleWidth > 0 ? pad(truncate(task.title, titleWidth - 1), titleWidth) : ""
  const statusStr = pad(`${indicator} ${task.status}`, COL.status)
  const isDone = variant === "done"
  const effectiveCompletedWidth = completedWidth ?? COL.completedDone
  const fourthColStr =
    isDone
      ? effectiveCompletedWidth > 0
        ? pad(truncate(formatCompletedAt(task.closedAt), effectiveCompletedWidth - 1), effectiveCompletedWidth)
        : ""
      : isMarkingReady
        ? pad("◌", COL.ready)
        : pad(
            task.labels?.includes("ready") ? "✓" : "",
            COL.ready,
          )
  const priorityStr = isDone
    ? ""
    : pad(
        task.priority !== undefined ? `P${task.priority}` : "—",
        COL.priority,
      )
  const durationStr = pad(computeDuration(task), COL.duration)

  const idColor = effectiveDimmed ? colors.fg.dim : colors.fg.muted
  const titleColor = effectiveDimmed
    ? colors.fg.dim
    : isSelected
      ? colors.fg.primary
      : colors.fg.secondary

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? colors.bg.highlight : "transparent",
      }}
    >
      <text>
        <span fg={idColor}>{idStr}</span>
        <span fg={colors.border.normal}>{ID_TITLE_SEP}</span>
        <span fg={titleColor}>{titleStr}</span>
        <span fg={sColor}>{statusStr}</span>
        <span fg={isDone ? colors.accent.secondary : isMarkingReady ? colors.status.warning : colors.status.success}>{fourthColStr}</span>
        <span fg={colors.fg.secondary}>{priorityStr}</span>
        <span fg={task.status === "active" || !effectiveDimmed ? colors.status.info : colors.fg.dim}>{durationStr}</span>
      </text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function DashboardTable({
  title,
  tasks,
  selectedIndex,
  scrollOffset,
  titleWidth,
  flexGrow,
  borderColor,
  variant,
  markingReadyIds,
  onVisibleRowCountChange,
  completedWidth,
}: {
  title: string
  tasks: WatchTask[]
  selectedIndex: number
  scrollOffset: number
  titleWidth: number
  flexGrow: number
  borderColor: string
  variant: TableVariant
  markingReadyIds?: Set<string>
  onVisibleRowCountChange?: (count: number) => void
  /** Dynamic completed-column width for the done variant. */
  completedWidth?: number
}): ReactNode {
  const boxRef = useRef<BoxRenderable>(null)
  const [visibleRowCount, setVisibleRowCount] = useState(0)

  useEffect(() => {
    const node = boxRef.current?.getLayoutNode()
    if (!node) return
    const measuredHeight = Math.floor(node.getComputedHeight())
    const count = deriveVisibleRowCount(measuredHeight)
    if (count !== visibleRowCount) {
      setVisibleRowCount(count)
      onVisibleRowCountChange?.(count)
    }
  })

  // Render only the visible window of rows
  const visibleSlice = tasks.slice(scrollOffset, scrollOffset + visibleRowCount)

  return (
    <box
      ref={boxRef}
      style={{
        width: "100%",
        flexGrow,
        flexShrink: 0,
        flexBasis: 0,
        minHeight: 5,
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor,
      }}
    >
      <DashboardSectionTitle title={title} />
      <DashboardTableHeader titleWidth={titleWidth} variant={variant} completedWidth={completedWidth} />
      <box style={{ flexGrow: 1, width: "100%" }}>
        {tasks.length === 0 ? (
          <box style={{ paddingLeft: 1, paddingTop: 0 }}>
            <text fg={colors.fg.muted}>No tasks</text>
          </box>
        ) : (
          visibleSlice.map((task, sliceIdx) => {
            const absoluteIdx = scrollOffset + sliceIdx
            return (
              <DashboardRow
                key={task.id}
                task={task}
                isSelected={absoluteIdx === selectedIndex}
                titleWidth={titleWidth}
                variant={variant}
                isMarkingReady={markingReadyIds?.has(task.id) ?? false}
                completedWidth={completedWidth}
              />
            )
          })
        )}
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Epic pane components
// ---------------------------------------------------------------------------

function EpicTableHeader({ titleWidth, statusWidth }: { titleWidth: number; statusWidth: number }): ReactNode {
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: colors.bg.secondary,
      }}
    >
      <text>
        <span fg={colors.fg.dim}>{pad("ID", COL.id)}</span>
        <span fg={colors.border.normal}>{ID_TITLE_SEP}</span>
        <span fg={colors.fg.muted}>
          {titleWidth > 0 ? pad("Title", titleWidth) : ""}
          {statusWidth > 0 ? pad("Status", statusWidth) : ""}
        </span>
      </text>
    </box>
  )
}

function EpicRow({
  epic,
  isSelected,
  titleWidth,
  statusWidth,
}: {
  epic: EpicDisplayItem
  isSelected: boolean
  titleWidth: number
  statusWidth: number
}): ReactNode {
  const indicator = epicStatusIndicator[epic.status]
  const sColor = epicStatusColor[epic.status]
  const isDimmed = epic.status === "queued_for_deletion"
  const effectiveDimmed = isDimmed && !isSelected

  const idStr = formatIdCell(epic.id)
  const titleStr = titleWidth > 0 ? pad(truncate(epic.title, titleWidth - 1), titleWidth) : ""
  const statusLabel = epic.status === "queued_for_deletion" ? "deleting" : epic.status
  const statusStr = statusWidth > 0 ? pad(truncate(`${indicator} ${statusLabel}`, statusWidth - 1), statusWidth) : ""

  const idColor = effectiveDimmed ? colors.fg.dim : colors.fg.muted
  const titleColor = effectiveDimmed
    ? colors.fg.dim
    : isSelected
      ? colors.fg.primary
      : colors.fg.secondary

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? colors.bg.highlight : "transparent",
      }}
    >
      <text>
        <span fg={idColor}>{idStr}</span>
        <span fg={colors.border.normal}>{ID_TITLE_SEP}</span>
        <span fg={titleColor}>{titleStr}</span>
        <span fg={sColor}>{statusStr}</span>
      </text>
    </box>
  )
}

function EpicTable({
  epics,
  selectedIndex,
  scrollOffset,
  titleWidth,
  statusWidth,
  borderColor,
  flexGrow,
  onVisibleRowCountChange,
}: {
  epics: EpicDisplayItem[]
  selectedIndex: number
  scrollOffset: number
  titleWidth: number
  /** Dynamic epic-status column width. */
  statusWidth: number
  borderColor: string
  flexGrow: number
  onVisibleRowCountChange?: (count: number) => void
}): ReactNode {
  const boxRef = useRef<BoxRenderable>(null)
  const [visibleRowCount, setVisibleRowCount] = useState(0)

  useEffect(() => {
    const node = boxRef.current?.getLayoutNode()
    if (!node) return
    const measuredHeight = Math.floor(node.getComputedHeight())
    const count = deriveVisibleRowCount(measuredHeight)
    if (count !== visibleRowCount) {
      setVisibleRowCount(count)
      onVisibleRowCountChange?.(count)
    }
  })

  const visibleSlice = epics.slice(scrollOffset, scrollOffset + visibleRowCount)

  return (
    <box
      ref={boxRef}
      style={{
        width: "100%",
        flexGrow,
        flexShrink: 0,
        flexBasis: 0,
        minHeight: 5,
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor,
      }}
    >
      <DashboardSectionTitle title="Epics" />
      <EpicTableHeader titleWidth={titleWidth} statusWidth={statusWidth} />
      <box style={{ flexGrow: 1, width: "100%" }}>
        {epics.length === 0 ? (
          <box style={{ paddingLeft: 1, paddingTop: 0 }}>
            <text fg={colors.fg.muted}>No epics</text>
          </box>
        ) : (
          visibleSlice.map((epic, sliceIdx) => {
            const absoluteIdx = scrollOffset + sliceIdx
            return (
              <EpicRow
                key={epic.id}
                epic={epic}
                isSelected={absoluteIdx === selectedIndex}
                titleWidth={titleWidth}
                statusWidth={statusWidth}
              />
            )
          })
        )}
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Live duration tick
// ---------------------------------------------------------------------------

/**
 * Return true when at least one task is active and has a valid startedAt
 * timestamp, meaning the dashboard should run a local duration tick.
 */
export function hasActiveTimedTask(tasks: WatchTask[]): boolean {
  for (const t of tasks) {
    if (t.status === "active" && t.startedAt) {
      const ms = new Date(t.startedAt).getTime()
      if (!Number.isNaN(ms)) return true
    }
  }
  return false
}

/**
 * Hook that maintains a one-second render tick while at least one dashboard
 * task needs a live elapsed-duration update. The tick value is unused — its
 * only purpose is to trigger a React re-render so that `computeDuration`
 * recalculates from `Date.now()`.
 *
 * The interval is created / destroyed reactively:
 * - starts when `needsTick` transitions to true
 * - stops when `needsTick` transitions to false (or on unmount)
 */
function useDurationTick(tasks: WatchTask[]): void {
  const [, setTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const needsTick = hasActiveTimedTask(tasks)

  useEffect(() => {
    if (needsTick) {
      intervalRef.current = setInterval(() => {
        setTick((n) => n + 1)
      }, 1_000)
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [needsTick])
}

// ---------------------------------------------------------------------------
// Visible row count computation
// ---------------------------------------------------------------------------

/**
 * Per-table chrome overhead: border top (1) + border bottom (1) + section
 * title (1) + column header (1) = 4 lines consumed before any data rows.
 */
export const TABLE_CHROME_LINES = 4

/**
 * Derive the number of visible data rows from a measured box height.
 * Subtracts the fixed chrome overhead and clamps to zero.
 */
export function deriveVisibleRowCount(measuredHeight: number): number {
  return Math.max(0, measuredHeight - TABLE_CHROME_LINES)
}

// ---------------------------------------------------------------------------
// Pane width computation (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Fixed-width sums for each pane variant. The +4 accounts for left/right
 * border (2) plus left/right row padding (2).
 */
const PANE_CHROME = 4

const activeFixedWidth =
  COL.id + COL.idTitleSep + COL.status + COL.ready + COL.priority + COL.duration + PANE_CHROME

export interface PaneWidths {
  activeTitleWidth: number
  doneTitleWidth: number
  epicTitleWidth: number
  /** Dynamic epic-status column width (capped at COL.epicStatus). Shrinks when the epic pane is narrow. */
  epicStatusWidth: number
  /** Dynamic done-completed column width (capped at COL.completedDone). Shrinks when the done pane is narrow. */
  doneCompletedWidth: number
  /** Estimated done-pane width matching the 2:1 flex split. */
  donePaneWidth: number
  /** Estimated epic-pane width matching the 2:1 flex split. */
  epicPaneWidth: number
}

/**
 * Derive pane-local column widths from the terminal width.
 *
 * The bottom row uses flexGrow 1 (epic) : 2 (done), so we mirror that
 * ratio.  Both pane estimates use Math.floor so they are conservatively
 * smaller-or-equal to the actual flex allocation — this prevents content
 * from overrunning the pane boundary even if the flex engine rounds
 * differently than our integer math.
 *
 * When a pane is too narrow for all fixed columns at their maximum size,
 * the title column shrinks to zero first, then the variable-width column
 * (epicStatus / completedDone) shrinks to fit the remaining budget.
 * This keeps the layout stable across terminal widths without clipping.
 */
export function computePaneWidths(terminalWidth: number): PaneWidths {
  // Bottom row: epic and done each get 1/2 — mirrors flexGrow 1:1.
  // BOTH estimates use Math.floor so they are strictly ≤ the actual flex
  // allocation regardless of how the engine rounds.  The 0-1 char "lost"
  // between 2×floor(tw/2) and tw is intentional slack that joins
  // WIDTH_SAFETY_MARGIN in preventing right-edge clipping.
  //
  // No artificial minimum clamp — the flex engine allocates based on the
  // ratio, not our estimate, so clamping would make the estimate optimistic
  // relative to reality and risk right-edge overflow.
  const epicPaneWidth = Math.floor(terminalWidth / 2)
  const donePaneWidth = Math.floor(terminalWidth / 2)

  // -- Active pane (full terminal width) --
  const activeTitleWidth = Math.max(0, terminalWidth - activeFixedWidth - WIDTH_SAFETY_MARGIN)

  // -- Epic pane --
  // Budget after chrome and safety margin:
  const epicBudget = Math.max(0, epicPaneWidth - PANE_CHROME - WIDTH_SAFETY_MARGIN)
  // Fixed base columns that are always present at full size:
  const epicBase = COL.id + COL.idTitleSep // 15
  const epicRemaining = Math.max(0, epicBudget - epicBase)
  // Status column gets priority; title gets the rest.
  const epicStatusWidth = Math.min(COL.epicStatus, epicRemaining)
  const epicTitleWidth = Math.max(0, epicRemaining - epicStatusWidth)

  // -- Done pane --
  const doneBudget = Math.max(0, donePaneWidth - PANE_CHROME - WIDTH_SAFETY_MARGIN)
  // Fixed base: ID + sep + status + duration (always rendered at full size)
  const doneBase = COL.id + COL.idTitleSep + COL.status + COL.duration // 37
  const doneRemaining = Math.max(0, doneBudget - doneBase)
  // Completed column gets priority; title gets the rest.
  const doneCompletedWidth = Math.min(COL.completedDone, doneRemaining)
  const doneTitleWidth = Math.max(0, doneRemaining - doneCompletedWidth)

  return {
    activeTitleWidth,
    doneTitleWidth,
    epicTitleWidth,
    epicStatusWidth,
    doneCompletedWidth,
    donePaneWidth,
    epicPaneWidth,
  }
}

// ---------------------------------------------------------------------------
// DashboardView (exported)
// ---------------------------------------------------------------------------

/** Which dashboard pane currently holds focus. */
export type FocusedTable = "active" | "done" | "epic"

export interface DashboardViewProps {
  tasks: WatchTask[]
  /** Epic display items for the epic pane. */
  epics: EpicDisplayItem[]
  /** Which table is focused. */
  focusedTable: FocusedTable
  /** Selected row index within the active (top) table, or -1 for no selection. */
  activeSelectedIndex: number
  /** Selected row index within the done (bottom) table, or -1 for no selection. */
  doneSelectedIndex: number
  /** Selected row index within the epic pane, or -1 for no selection. */
  epicSelectedIndex: number
  /** Scroll offset (first visible row) for the active table. */
  activeScrollOffset: number
  /** Scroll offset (first visible row) for the done table. */
  doneScrollOffset: number
  /** Scroll offset (first visible row) for the epic pane. */
  epicScrollOffset: number
  terminalWidth: number
  /** Set of task IDs currently being marked ready (shows ◌ loading indicator). */
  markingReadyIds?: Set<string>
  /** Callback when the active table's measured visible row count changes. */
  onActiveVisibleRowCountChange?: (count: number) => void
  /** Callback when the done table's measured visible row count changes. */
  onDoneVisibleRowCountChange?: (count: number) => void
  /** Callback when the epic pane's measured visible row count changes. */
  onEpicVisibleRowCountChange?: (count: number) => void
}

// ---------------------------------------------------------------------------
// StatsFooter — summary bar rendered between Active and Done tables
// ---------------------------------------------------------------------------

function StatsFooter({ tasks }: { tasks: WatchTask[] }): ReactNode {
  const now = new Date()
  const day = computeDayTotal(tasks, now)
  const week = computeWeekTotal(tasks, now)

  if (week.count === 0) {
    return (
      <box
        style={{
          width: "100%",
          height: 1,
          flexDirection: "row",
          backgroundColor: colors.bg.secondary,
          justifyContent: "flex-end",
          alignItems: "center",
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={colors.fg.muted}>Today: </text>
        <text fg={colors.status.info}>—</text>
        <text fg={colors.fg.muted}> │ This week: </text>
        <text fg={colors.status.info}>—</text>
      </box>
    )
  }

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: colors.bg.secondary,
        justifyContent: "flex-end",
        alignItems: "center",
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={colors.fg.muted}>Today: </text>
      <text fg={colors.status.info}>{day.count > 0 ? formatDuration(day.totalMs) : "—"}</text>
      <text fg={colors.fg.muted}> │ This week: </text>
      <text fg={colors.status.info}>{formatDuration(week.totalMs)}</text>
    </box>
  )
}

/**
 * Dashboard landing view: active tasks on top, with done tasks and epics
 * sharing the lower row in a horizontal split. Only the focused pane shows
 * its selection highlight and active border. The epic pane is always rendered
 * so the redesigned layout stays visible even before the first epic exists.
 */
export function DashboardView({
  tasks,
  epics,
  focusedTable,
  activeSelectedIndex,
  doneSelectedIndex,
  epicSelectedIndex,
  activeScrollOffset,
  doneScrollOffset,
  epicScrollOffset,
  terminalWidth,
  markingReadyIds,
  onActiveVisibleRowCountChange,
  onDoneVisibleRowCountChange,
  onEpicVisibleRowCountChange,
}: DashboardViewProps): ReactNode {
  // Drive a one-second re-render while any active task needs a live duration.
  useDurationTick(tasks)

  const { active, done: unsortedDone } = partitionTasks(tasks)
  const done = sortDoneTasks(unsortedDone)

  // Derive pane-local column widths from the live terminal width.
  const { activeTitleWidth, doneTitleWidth, epicTitleWidth, epicStatusWidth, doneCompletedWidth } =
    computePaneWidths(terminalWidth)

  return (
    <box
      style={{
        width: "100%",
        flexGrow: 1,
        flexDirection: "column",
      }}
    >
      <DashboardTable
        title="Active"
        tasks={active}
        selectedIndex={focusedTable === "active" ? activeSelectedIndex : -1}
        scrollOffset={activeScrollOffset}
        titleWidth={activeTitleWidth}
        flexGrow={2}
        borderColor={
          focusedTable === "active"
            ? colors.accent.primary
            : colors.border.normal
        }
        variant="active"
        markingReadyIds={markingReadyIds}
        onVisibleRowCountChange={onActiveVisibleRowCountChange}
      />
      <StatsFooter tasks={tasks} />
      <box
        style={{
          width: "100%",
          flexGrow: 1,
          flexShrink: 0,
          flexBasis: 0,
          flexDirection: "row",
        }}
      >
        <box
          style={{
            flexGrow: 1,
            flexShrink: 0,
            flexBasis: 0,
          }}
        >
          <EpicTable
            epics={epics}
            selectedIndex={focusedTable === "epic" ? epicSelectedIndex : -1}
            scrollOffset={epicScrollOffset}
            titleWidth={epicTitleWidth}
            statusWidth={epicStatusWidth}
            borderColor={
              focusedTable === "epic"
                ? colors.accent.primary
                : colors.border.normal
            }
            flexGrow={1}
            onVisibleRowCountChange={onEpicVisibleRowCountChange}
          />
        </box>
        <box
          style={{
            flexGrow: 1,
            flexShrink: 0,
            flexBasis: 0,
          }}
        >
          <DashboardTable
            title="Done"
            tasks={done}
            selectedIndex={focusedTable === "done" ? doneSelectedIndex : -1}
            scrollOffset={doneScrollOffset}
            titleWidth={doneTitleWidth}
            flexGrow={1}
            borderColor={
              focusedTable === "done"
                ? colors.accent.primary
                : colors.border.normal
            }
            variant="done"
            completedWidth={doneCompletedWidth}
            onVisibleRowCountChange={onDoneVisibleRowCountChange}
          />
        </box>
      </box>
    </box>
  )
}
