/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Dashboard landing view for the watch TUI.
 * Renders two stacked tables: a top table for non-done tasks
 * (backlog, actionable, blocked, active, error) and a bottom
 * table for done tasks. The active table shows Label while the
 * done table shows a compact Completed datetime instead.
 * Shared columns: ID, Title (clipped), Status, Priority, Duration.
 */

import type { ReactNode } from "react"
import { useState, useEffect, useRef } from "react"
import type { BoxRenderable } from "@opentui/core"
import type { WatchTask, WatchTaskStatus } from "../beadsAdapter.js"

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

const taskStatusColor: Record<WatchTaskStatus, string> = {
  backlog: colors.fg.muted,
  actionable: colors.status.success,
  active: colors.status.success,
  blocked: colors.status.error,
  done: colors.status.success,
  error: colors.status.error,
}

const taskStatusIndicator: Record<WatchTaskStatus, string> = {
  backlog: "·",
  actionable: "○",
  active: "▶",
  blocked: "⊘",
  done: "✓",
  error: "✗",
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
  label: 14,
  priority: 5,
  duration: 10,
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
 * - backlog / actionable / blocked / incomplete metadata: "—"
 */
export function computeDuration(task: WatchTask): string {
  const { status, startedAt, finishedAt } = task

  // Statuses that never show duration
  if (status === "backlog" || status === "actionable" || status === "blocked") {
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
  "actionable",
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
 */
export function partitionTasks(tasks: WatchTask[]): DashboardPartition {
  const active: WatchTask[] = []
  const done: WatchTask[] = []

  for (const task of tasks) {
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

function DashboardTableHeader({ titleWidth, variant }: { titleWidth: number; variant: TableVariant }): ReactNode {
  const fourthCol = variant === "done" ? "Completed" : "Label"
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
          {pad(fourthCol, COL.label)}
          {pad("Pri", COL.priority)}
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
}: {
  task: WatchTask
  isSelected: boolean
  titleWidth: number
  variant: TableVariant
}): ReactNode {
  const indicator = taskStatusIndicator[task.status]
  const sColor = taskStatusColor[task.status]
  const isDimmed = task.status === "done" || task.status === "error"

  const idStr = formatIdCell(task.id)
  const titleStr = pad(truncate(task.title, titleWidth - 1), titleWidth)
  const statusStr = pad(`${indicator} ${task.status}`, COL.status)
  const fourthColStr =
    variant === "done"
      ? pad(truncate(formatCompletedAt(task.closedAt), COL.label - 1), COL.label)
      : pad(
          task.labels && task.labels.length > 0
            ? truncate(task.labels.join(", "), COL.label - 1)
            : "—",
          COL.label,
        )
  const priorityStr = pad(
    task.priority !== undefined ? `P${task.priority}` : "—",
    COL.priority,
  )
  const durationStr = pad(computeDuration(task), COL.duration)

  const idColor = isDimmed ? colors.fg.dim : colors.fg.muted
  const titleColor = isDimmed
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
        <span fg={colors.accent.secondary}>{fourthColStr}</span>
        <span fg={colors.fg.secondary}>{priorityStr}</span>
        <span fg={task.status === "active" ? colors.status.info : colors.fg.dim}>{durationStr}</span>
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
}: {
  title: string
  tasks: WatchTask[]
  selectedIndex: number
  scrollOffset: number
  titleWidth: number
  flexGrow: number
  borderColor: string
  variant: TableVariant
}): ReactNode {
  const boxRef = useRef<BoxRenderable>(null)
  const [visibleRowCount, setVisibleRowCount] = useState(0)

  useEffect(() => {
    const node = boxRef.current?.getLayoutNode()
    if (!node) return
    const measuredHeight = Math.floor(node.getComputedHeight())
    setVisibleRowCount(Math.max(0, measuredHeight - TABLE_CHROME_LINES))
  })

  // Render only the visible window of rows
  const visibleSlice = tasks.slice(scrollOffset, scrollOffset + visibleRowCount)

  return (
    <box
      ref={boxRef}
      style={{
        width: "100%",
        flexGrow,
        flexShrink: 1,
        minHeight: 5,
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor,
      }}
    >
      <DashboardSectionTitle title={title} />
      <DashboardTableHeader titleWidth={titleWidth} variant={variant} />
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
const TABLE_CHROME_LINES = 4

/**
 * Compute the visible row capacity for each dashboard table given the total
 * terminal height. The active table uses flexGrow 2 and the done table uses
 * flexGrow 1, so the available dashboard area is split 2:1.
 *
 * Subtracts 2 for the application header and footer, then subtracts per-table
 * chrome (border + section title + column header) from each table's share.
 *
 * Exported for testing.
 */
export function computeVisibleRowCounts(terminalHeight: number): {
  activeVisibleRows: number
  doneVisibleRows: number
} {
  const dashboardHeight = Math.max(0, terminalHeight - 2) // header + footer
  const activeTableHeight = Math.floor((dashboardHeight * 2) / 3)
  const doneTableHeight = dashboardHeight - activeTableHeight
  return {
    activeVisibleRows: Math.max(0, activeTableHeight - TABLE_CHROME_LINES),
    doneVisibleRows: Math.max(0, doneTableHeight - TABLE_CHROME_LINES),
  }
}

// ---------------------------------------------------------------------------
// DashboardView (exported)
// ---------------------------------------------------------------------------

/** Which dashboard table currently holds focus. */
export type FocusedTable = "active" | "done"

export interface DashboardViewProps {
  tasks: WatchTask[]
  /** Which table is focused. */
  focusedTable: FocusedTable
  /** Selected row index within the active (top) table, or -1 for no selection. */
  activeSelectedIndex: number
  /** Selected row index within the done (bottom) table, or -1 for no selection. */
  doneSelectedIndex: number
  /** Scroll offset (first visible row) for the active table. */
  activeScrollOffset: number
  /** Scroll offset (first visible row) for the done table. */
  doneScrollOffset: number
  terminalWidth: number
}

/**
 * Dashboard landing view: two vertically stacked tables.
 * Top table = non-done tasks. Bottom table = done tasks.
 * Only the focused table shows its selection highlight and active border.
 */
export function DashboardView({
  tasks,
  focusedTable,
  activeSelectedIndex,
  doneSelectedIndex,
  activeScrollOffset,
  doneScrollOffset,
  terminalWidth,
}: DashboardViewProps): ReactNode {
  // Drive a one-second re-render while any active task needs a live duration.
  useDurationTick(tasks)

  const { active, done: unsortedDone } = partitionTasks(tasks)
  const done = sortDoneTasks(unsortedDone)

  // Compute dynamic title column width from available terminal space
  const fixedColumnsWidth =
    COL.id + COL.idTitleSep + COL.status + COL.label + COL.priority + COL.duration + 4 // +4 for padding/border
  const titleWidth = Math.max(10, terminalWidth - fixedColumnsWidth)

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
        titleWidth={titleWidth}
        flexGrow={2}
        borderColor={
          focusedTable === "active"
            ? colors.accent.primary
            : colors.border.normal
        }
        variant="active"
      />
      <DashboardTable
        title="Done"
        tasks={done}
        selectedIndex={focusedTable === "done" ? doneSelectedIndex : -1}
        scrollOffset={doneScrollOffset}
        titleWidth={titleWidth}
        flexGrow={1}
        borderColor={
          focusedTable === "done"
            ? colors.accent.primary
            : colors.border.normal
        }
        variant="done"
      />
    </box>
  )
}
