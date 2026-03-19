/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Dashboard landing view for the watch TUI.
 * Renders two stacked tables: a top table for non-done tasks
 * (backlog, actionable, blocked, active, error) and a bottom
 * table for done tasks. Both tables share the same column set:
 * ID, Title (clipped), Status, Label, Priority, Duration.
 */

import type { ReactNode } from "react"
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
  id: 10,
  status: 12,
  label: 14,
  priority: 5,
  duration: 10,
  /** Title takes remaining space — computed dynamically. */
} as const

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return text.slice(0, max - 1) + "…"
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  return text + " ".repeat(width - text.length)
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

// ---------------------------------------------------------------------------
// Table header
// ---------------------------------------------------------------------------

function DashboardTableHeader({ titleWidth }: { titleWidth: number }): ReactNode {
  return (
    <box
      style={{
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: colors.bg.secondary,
      }}
    >
      <text>
        <span fg={colors.fg.muted}>
          {pad("ID", COL.id)}
          {pad("Title", titleWidth)}
          {pad("Status", COL.status)}
          {pad("Label", COL.label)}
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
}: {
  task: WatchTask
  isSelected: boolean
  titleWidth: number
}): ReactNode {
  const indicator = taskStatusIndicator[task.status]
  const sColor = taskStatusColor[task.status]
  const isDimmed = task.status === "done" || task.status === "error"

  const idStr = pad(task.id, COL.id)
  const titleStr = pad(truncate(task.title, titleWidth - 1), titleWidth)
  const statusStr = pad(`${indicator} ${task.status}`, COL.status)
  const labelStr = pad(
    task.labels && task.labels.length > 0
      ? truncate(task.labels.join(", "), COL.label - 1)
      : "—",
    COL.label,
  )
  const priorityStr = pad(
    task.priority !== undefined ? `P${task.priority}` : "—",
    COL.priority,
  )
  const durationStr = pad("—", COL.duration) // placeholder until timing metadata

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
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? colors.bg.highlight : "transparent",
      }}
    >
      <text>
        <span fg={idColor}>{idStr}</span>
        <span fg={titleColor}>{titleStr}</span>
        <span fg={sColor}>{statusStr}</span>
        <span fg={colors.accent.secondary}>{labelStr}</span>
        <span fg={colors.fg.secondary}>{priorityStr}</span>
        <span fg={colors.fg.dim}>{durationStr}</span>
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
  titleWidth,
  flexGrow,
  borderColor,
}: {
  title: string
  tasks: WatchTask[]
  selectedIndex: number
  titleWidth: number
  flexGrow: number
  borderColor: string
}): ReactNode {
  return (
    <box
      title={title}
      style={{
        width: "100%",
        flexGrow,
        flexShrink: 1,
        minHeight: 4,
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor,
      }}
    >
      <DashboardTableHeader titleWidth={titleWidth} />
      <scrollbox style={{ flexGrow: 1, width: "100%" }}>
        {tasks.length === 0 ? (
          <box style={{ paddingLeft: 1, paddingTop: 0 }}>
            <text fg={colors.fg.muted}>No tasks</text>
          </box>
        ) : (
          tasks.map((task, idx) => (
            <DashboardRow
              key={task.id}
              task={task}
              isSelected={idx === selectedIndex}
              titleWidth={titleWidth}
            />
          ))
        )}
      </scrollbox>
    </box>
  )
}

// ---------------------------------------------------------------------------
// DashboardView (exported)
// ---------------------------------------------------------------------------

export interface DashboardViewProps {
  tasks: WatchTask[]
  selectedIndex: number
  terminalWidth: number
}

/**
 * Dashboard landing view: two vertically stacked tables.
 * Top table = non-done tasks. Bottom table = done tasks.
 */
export function DashboardView({
  tasks,
  selectedIndex,
  terminalWidth,
}: DashboardViewProps): ReactNode {
  const { active, done } = partitionTasks(tasks)

  // Compute dynamic title column width from available terminal space
  const fixedColumnsWidth =
    COL.id + COL.status + COL.label + COL.priority + COL.duration + 4 // +4 for padding/border
  const titleWidth = Math.max(10, terminalWidth - fixedColumnsWidth)

  // Determine which table the selection falls into and the local index
  const activeSelected =
    selectedIndex < active.length ? selectedIndex : -1
  const doneSelected =
    selectedIndex >= active.length
      ? selectedIndex - active.length
      : -1

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
        selectedIndex={activeSelected}
        titleWidth={titleWidth}
        flexGrow={2}
        borderColor={colors.accent.primary}
      />
      <DashboardTable
        title="Done"
        tasks={done}
        selectedIndex={doneSelected}
        titleWidth={titleWidth}
        flexGrow={1}
        borderColor={colors.border.normal}
      />
    </box>
  )
}
