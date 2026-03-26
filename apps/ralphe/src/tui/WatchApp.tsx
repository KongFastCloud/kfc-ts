/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-mode TUI application component.
 * Renders a split view with three panes: Active tasks (primary),
 * Done tasks, and Epic pane (secondary, focusable). The dashboard
 * landing screen supports tab-cycling through all three panes.
 * Enter navigates from task panes to detail; Esc/Backspace returns.
 * Epic pane does not support detail drill-down.
 *
 * Key bindings:
 * - Tab: cycle focus through active → done → epic → active
 * - m: mark-ready (task panes only)
 * - d: delete epic (epic pane only, immediate, no confirmation)
 * - Enter: detail view (task panes only)
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import type { WatchTask, WatchTaskStatus } from "../beadsAdapter.js"
import { getAvailableActions } from "../beadsAdapter.js"
import type { RalpheConfig, GitMode } from "../config.js"
import type { WorkerStatus } from "../tuiWorker.js"
import type { EpicDisplayItem } from "./epicStatus.js"
import { DashboardView, partitionTasks, formatCompletedAt, formatDuration } from "./DashboardView.js"
import {
  initialDashboardFocusState,
  toggleFocusedTable,
  moveSelectionUp,
  moveSelectionDown,
  enterDetail,
  returnFromDetail,
  clampAfterRefresh,
} from "./dashboardFocus.js"

// ---------------------------------------------------------------------------
// Theme (inline subset — avoids coupling to ralph-tui's theme package)
// ---------------------------------------------------------------------------

/** Stable empty set to avoid re-renders when no pending IDs are provided. */
const emptySet: ReadonlySet<string> = new Set()

const colors = {
  bg: { primary: "#1a1b26", secondary: "#24283b", tertiary: "#2f3449", highlight: "#3d4259" },
  fg: { primary: "#c0caf5", secondary: "#a9b1d6", muted: "#565f89", dim: "#414868" },
  status: { success: "#9ece6a", warning: "#e0af68", error: "#f7768e", info: "#7aa2f7" },
  accent: { primary: "#7aa2f7", secondary: "#bb9af7", tertiary: "#7dcfff" },
  border: { normal: "#3d4259", active: "#7aa2f7", muted: "#2f3449" },
} as const

// Status theme used by DetailPane
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchAppProps {
  /** Current task list — projected from controller state. */
  tasks: WatchTask[]
  /** Epic display items for the epic pane. */
  epics: EpicDisplayItem[]
  /** Current refresh error — projected from controller state. */
  error: string | undefined
  /** Timestamp of last successful refresh — projected from controller state. */
  lastRefreshed: Date | null
  /**
   * Trigger a refresh. The controller owns task data and error state;
   * this is a fire-and-forget command, not a data-fetching callback.
   */
  onRefresh: () => Promise<void>
  /** Callback when the user quits. */
  onQuit?: () => void
  /** Current worker status (idle/running). */
  workerStatus?: WorkerStatus | undefined
  /** Current ralphe config for header display. */
  config?: RalpheConfig | undefined
  /**
   * Enqueue a mark-ready action into the controller's Effect-native queue.
   * Synchronous and non-blocking. Duplicate task IDs are silently rejected.
   */
  onEnqueueMarkReady?: ((id: string, labels: string[]) => void) | undefined
  /**
   * Set of task IDs currently queued or in-flight for mark-ready.
   * Provided by the controller's queue state for loading indicators.
   */
  markReadyPendingIds?: ReadonlySet<string> | undefined
  /** Full detail task from the detail query (bd show). */
  detailTask?: WatchTask | undefined
  /** Whether a detail fetch is in-flight. */
  detailLoading?: boolean | undefined
  /** Error message from the last detail fetch failure. */
  detailError?: string | undefined
  /** Callback to fetch full detail for a task when entering detail view. */
  onFetchTaskDetail?: ((taskId: string) => void) | undefined
  /** Callback to clear detail state when exiting detail view. */
  onExitDetailView?: (() => void) | undefined
  /**
   * Enqueue an epic deletion action. Immediate, no confirmation.
   * The epic will be closed in Beads and its worktree removed.
   */
  onEnqueueEpicDelete?: ((epicId: string) => void) | undefined
  /**
   * Set of epic IDs currently queued or in-flight for deletion.
   */
  epicDeletePendingIds?: ReadonlySet<string> | undefined
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const gitModeLabel: Record<GitMode, string> = {
  none: "none",
  commit: "commit",
  commit_and_push: "push",
  commit_and_push_and_wait_ci: "ci",
}

function formatConfigSummary(config: RalpheConfig): string {
  return [
    config.engine,
    `${config.maxAttempts} attempts`,
    `${config.checks.length} checks`,
    gitModeLabel[config.git.mode],
    config.report,
  ].join(" │ ")
}

/** Max display width for a worker task ID in the header. */
const MAX_TASK_ID_DISPLAY = 16

/**
 * Extra slack to absorb potential double-width emoji rendering (◉, ⚡, ⏱, ⚠)
 * and any sub-character rounding differences between measured and actual width.
 */
const HEADER_SAFETY_MARGIN = 4

/**
 * Compute the width budget for the header's right section so we can
 * dynamically allocate the remaining space to the error message.
 *
 * Exported (via the test-only re-export) so we can verify the invariant that
 * left + config + right never exceeds the available content width.
 */
export function computeHeaderRightWidth(
  workerStatus: { state: string; currentTaskId?: string | null } | undefined,
  totalTasks: number,
  timeStr: string,
): { rightWidth: number; taskIdDisplay: string | undefined } {
  const taskCountStr = `${totalTasks} tasks`
  const timeDisplay = `⏱ ${timeStr}`
  const taskIdDisplay = workerStatus?.currentTaskId
    ? truncate(workerStatus.currentTaskId, MAX_TASK_ID_DISPLAY)
    : undefined
  const workerLabel = workerStatus
    ? (workerStatus.state === "running" ? "⚡ running" : "● idle")
    : undefined
  const workerWidth = workerLabel
    ? workerLabel.length + (taskIdDisplay ? ` [${taskIdDisplay}]`.length : 0)
    : 0

  // Gaps between the three items in the right section (gap: 2 between each)
  const rightGaps = workerLabel ? 4 : 0 // two gaps of 2 when worker is present
  const rightWidth = workerWidth + rightGaps + taskCountStr.length + timeDisplay.length

  return { rightWidth, taskIdDisplay }
}

/**
 * Compute the maximum error display width that keeps total header content
 * within `contentWidth`. Returns 0 when there is no room for the error.
 */
export function computeHeaderErrorBudget(
  contentWidth: number,
  rightWidth: number,
  configWidth: number,
  showConfig: boolean,
): number {
  // Left fixed: "◉ ralphe watch" occupies 14 visible columns.
  // The error prefix " ⚠ " adds 3 more characters.
  const leftFixed = 14
  const errorPrefix = 3 // " ⚠ "
  const usedWidth =
    leftFixed + rightWidth + (showConfig ? configWidth : 0) + HEADER_SAFETY_MARGIN
  return Math.max(0, contentWidth - usedWidth - errorPrefix)
}

function WatchHeader({
  totalTasks,
  lastRefreshed,
  error,
  workerStatus,
  config,
}: {
  totalTasks: number
  lastRefreshed: Date | null
  error: string | undefined
  workerStatus?: WorkerStatus | undefined
  config?: RalpheConfig | undefined
}): ReactNode {
  const { width: termWidth } = useTerminalDimensions()
  const contentWidth = Math.max(0, termWidth - 2) // paddingLeft + paddingRight

  const timeStr = lastRefreshed
    ? lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—"

  const { rightWidth, taskIdDisplay } = computeHeaderRightWidth(workerStatus, totalTasks, timeStr)

  // Config section — only shown when there is enough room.
  const configStr = config ? formatConfigSummary(config) : null
  const configWidth = configStr ? configStr.length + 4 : 0 // +4 for surrounding gaps
  const leftFixed = 14 // "◉ ralphe watch"
  const showConfig =
    configStr != null &&
    contentWidth >= leftFixed + configWidth + rightWidth + HEADER_SAFETY_MARGIN

  // Error budget: remaining space after left label, right section, optional config, and safety margin.
  const errorBudget = error
    ? computeHeaderErrorBudget(contentWidth, rightWidth, configWidth, showConfig)
    : 0

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: colors.bg.secondary,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <box style={{ flexDirection: "row", gap: 1 }}>
        <text>
          <span fg={colors.accent.primary}>◉</span>
          <span fg={colors.fg.primary}> ralphe watch</span>
        </text>
        {error && errorBudget > 0 && (
          <text>
            <span fg={colors.status.error}> ⚠ {truncate(error, errorBudget)}</span>
          </text>
        )}
      </box>
      {showConfig && (
        <text fg={colors.fg.muted}>{configStr}</text>
      )}
      <box style={{ flexDirection: "row", gap: 2 }}>
        {workerStatus && (
          <text>
            <span fg={
              workerStatus.state === "running"
                ? colors.status.success
                : colors.fg.muted
            }>
              {workerStatus.state === "running"
                ? "⚡ running"
                : "● idle"}
            </span>
            {taskIdDisplay && (
              <span fg={colors.accent.secondary}> [{taskIdDisplay}]</span>
            )}
          </text>
        )}
        <text fg={colors.fg.secondary}>{totalTasks} tasks</text>
        <text fg={colors.fg.muted}>⏱ {timeStr}</text>
      </box>
    </box>
  )
}

/**
 * Extra slack for the footer to absorb potential double-width arrow glyphs (↑↓)
 * and any rounding differences.
 */
const FOOTER_SAFETY_MARGIN = 2

/**
 * Build the footer shortcut string and clamp it to the available width.
 * Exported so tests can verify the truncation invariant without rendering.
 */
export function buildFooterText(
  viewMode: "dashboard" | "detail",
  termWidth: number,
  hasMarkReady?: boolean,
  hasEpicDelete?: boolean,
): string {
  const navShortcuts =
    viewMode === "detail"
      ? "Esc/Backspace:Back  ^Q:Quit"
      : `↑↓:Navigate  Tab:Switch Pane  Enter:Detail  r:Refresh${hasMarkReady ? "  m:Mark Ready" : ""}${hasEpicDelete ? "  d:Delete Epic" : ""}  ^Q:Quit`
  // Content area = termWidth minus paddingLeft(1) + paddingRight(1) + safety margin
  const safeWidth = Math.max(0, termWidth - 2 - FOOTER_SAFETY_MARGIN)
  return truncate(navShortcuts, safeWidth)
}

function WatchFooter({ viewMode, hasMarkReady, hasEpicDelete }: { viewMode: "dashboard" | "detail"; hasMarkReady?: boolean; hasEpicDelete?: boolean }): ReactNode {
  const { width: termWidth } = useTerminalDimensions()
  const displayText = buildFooterText(viewMode, termWidth, hasMarkReady, hasEpicDelete)
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
      <text fg={colors.fg.muted}>{displayText}</text>
    </box>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return text.slice(0, max - 1) + "…"
}

function DetailPane({ task, loading, error: detailFetchError }: { task: WatchTask | null; loading?: boolean; error?: string }): ReactNode {
  if (!task) {
    return (
      <box
        title="Details"
        style={{
          flexGrow: 2,
          flexShrink: 1,
          minWidth: 40,
          flexDirection: "column",
          backgroundColor: colors.bg.primary,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <box style={{ padding: 2 }}>
          <text fg={colors.fg.muted}>Select a task to view details</text>
        </box>
      </box>
    )
  }

  const sColor = taskStatusColor[task.status]
  const sIndicator = taskStatusIndicator[task.status]

  return (
    <box
      title="Details"
      style={{
        flexGrow: 2,
        flexShrink: 1,
        minWidth: 40,
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      <scrollbox style={{ flexGrow: 1, padding: 1 }}>
        {/* Title + status */}
        <box style={{ marginBottom: 1 }}>
          <text>
            <span fg={sColor}>{sIndicator}</span>
            <span fg={colors.fg.primary}> {task.title}</span>
          </text>
        </box>

        {/* Detail loading indicator */}
        {loading && (
          <box style={{ marginBottom: 1 }}>
            <text fg={colors.fg.muted}>Loading full detail…</text>
          </box>
        )}

        {/* Detail fetch error */}
        {detailFetchError && (
          <box style={{ marginBottom: 1 }}>
            <text fg={colors.status.error}>⚠ {detailFetchError}</text>
          </box>
        )}

        {/* Metadata block */}
        <box
          style={{
            marginBottom: 1,
            padding: 1,
            backgroundColor: colors.bg.secondary,
            border: true,
            borderColor: colors.border.muted,
            flexDirection: "column",
          }}
        >
          <box style={{ flexDirection: "row" }}>
            <text fg={colors.fg.muted}>ID: </text>
            <text fg={colors.fg.secondary}>{task.id}</text>
          </box>
          <box style={{ flexDirection: "row" }}>
            <text fg={colors.fg.muted}>Status: </text>
            <text fg={sColor}>{task.status}</text>
          </box>
          {task.priority !== undefined && (
            <box style={{ flexDirection: "row" }}>
              <text fg={colors.fg.muted}>Priority: </text>
              <text fg={colors.fg.secondary}>P{task.priority}</text>
            </box>
          )}
          {task.issueType && (
            <box style={{ flexDirection: "row" }}>
              <text fg={colors.fg.muted}>Type: </text>
              <text fg={colors.fg.secondary}>{task.issueType}</text>
            </box>
          )}
          {task.owner && (
            <box style={{ flexDirection: "row" }}>
              <text fg={colors.fg.muted}>Owner: </text>
              <text fg={colors.fg.secondary}>{task.owner}</text>
            </box>
          )}
          {task.labels && task.labels.length > 0 && (
            <box style={{ flexDirection: "row" }}>
              <text fg={colors.fg.muted}>Labels: </text>
              <text fg={colors.accent.secondary}>{task.labels.join(", ")}</text>
            </box>
          )}
        </box>

        {/* Error */}
        {(task.error || task.status === "error") && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.status.error}>Error</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.status.error,
                flexDirection: "column",
              }}
            >
              {task.error ? (
                task.error.split("\n").map((line, i) => (
                  <text key={i} fg={colors.fg.secondary}>
                    {line}
                  </text>
                ))
              ) : (
                <text fg={colors.fg.muted}>
                  Task failed — no error details available
                </text>
              )}
            </box>
          </box>
        )}

        {/* Activity Log */}
        {task.comments && task.comments.length > 0 && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Activity Log</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.border.muted,
                flexDirection: "column",
              }}
            >
              {task.comments.map((comment, i) => (
                <box key={comment.id} style={{ marginBottom: i < task.comments!.length - 1 ? 1 : 0, flexDirection: "column" }}>
                  <text fg={colors.fg.muted}>
                    {formatCompletedAt(comment.createdAt)}
                    {comment.author ? ` — ${comment.author}` : ""}
                  </text>
                  {comment.text.split("\n").map((line, j) => (
                    <text key={j} fg={colors.fg.secondary}>{line}</text>
                  ))}
                </box>
              ))}
            </box>
          </box>
        )}

        {/* Description */}
        {task.description && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Description</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.border.muted,
              }}
            >
              <text fg={colors.fg.secondary}>{task.description}</text>
            </box>
          </box>
        )}

        {/* Design */}
        {task.design && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Design</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.border.muted,
              }}
            >
              <text fg={colors.fg.secondary}>{task.design}</text>
            </box>
          </box>
        )}

        {/* Acceptance Criteria */}
        {task.acceptance_criteria && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Acceptance Criteria</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.border.muted,
                flexDirection: "column",
              }}
            >
              {task.acceptance_criteria.split("\n").map((line, i) => {
                const checkMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/)
                if (checkMatch) {
                  const checked = checkMatch[1]!.toLowerCase() === "x"
                  return (
                    <box key={i} style={{ flexDirection: "row" }}>
                      <text>
                        <span fg={checked ? colors.status.success : colors.fg.muted}>
                          {checked ? "[x]" : "[ ]"}
                        </span>
                        <span fg={checked ? colors.fg.muted : colors.fg.secondary}>
                          {" "}{checkMatch[2]}
                        </span>
                      </text>
                    </box>
                  )
                }
                return (
                  <text key={i} fg={colors.fg.secondary}>{line}</text>
                )
              })}
            </box>
          </box>
        )}

        {/* Notes */}
        {task.notes && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Notes</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.border.muted,
              }}
            >
              <text fg={colors.fg.secondary}>{task.notes}</text>
            </box>
          </box>
        )}

        {/* Dependencies */}
        {((task.dependsOn && task.dependsOn.length > 0) ||
          (task.blocks && task.blocks.length > 0)) && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Dependencies</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.border.muted,
                flexDirection: "column",
              }}
            >
              {task.dependsOn && task.dependsOn.length > 0 && (
                <box style={{ marginBottom: 0 }}>
                  <text fg={colors.status.warning}>Depends on:</text>
                  {task.dependsOn.map((dep) => (
                    <text key={dep} fg={colors.fg.secondary}>  - {dep}</text>
                  ))}
                </box>
              )}
              {task.blocks && task.blocks.length > 0 && (
                <box>
                  <text fg={colors.accent.tertiary}>Blocks:</text>
                  {task.blocks.map((dep) => (
                    <text key={dep} fg={colors.fg.secondary}>  - {dep}</text>
                  ))}
                </box>
              )}
            </box>
          </box>
        )}

        {/* Close reason */}
        {task.closeReason && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Close Reason</text>
            </box>
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.status.success,
              }}
            >
              <text fg={colors.fg.secondary}>{task.closeReason}</text>
            </box>
          </box>
        )}

        {/* Timestamps */}
        {(task.createdAt || task.updatedAt) && (
          <box style={{ marginTop: 1 }}>
            {task.createdAt && (
              <text fg={colors.fg.dim}>
                Created: {new Date(task.createdAt).toLocaleString()}
              </text>
            )}
            {task.updatedAt && (
              <text fg={colors.fg.dim}>
                {" "}| Updated: {new Date(task.updatedAt).toLocaleString()}
              </text>
            )}
          </box>
        )}
      </scrollbox>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Main WatchApp
// ---------------------------------------------------------------------------

export function WatchApp({
  tasks,
  epics,
  error,
  lastRefreshed,
  onRefresh,
  onQuit,
  workerStatus,
  config,
  onEnqueueMarkReady,
  markReadyPendingIds: markReadyPendingIdsProp,
  detailTask: detailTaskProp,
  detailLoading: detailLoadingProp,
  detailError: detailErrorProp,
  onFetchTaskDetail,
  onExitDetailView,
  onEnqueueEpicDelete,
  epicDeletePendingIds: epicDeletePendingIdsProp,
}: WatchAppProps): ReactNode {
  const { width } = useTerminalDimensions()

  // Dashboard focus and per-table selection state (single source of truth)
  const [focusState, setFocusState] = useState(initialDashboardFocusState)
  const { focusedTable, activeSelectedIndex, doneSelectedIndex, epicSelectedIndex, activeScrollOffset, doneScrollOffset, epicScrollOffset, viewMode } = focusState

  // Measured visible row counts from DashboardTable (updated via callbacks)
  const [activeVisibleRows, setActiveVisibleRows] = useState(0)
  const [doneVisibleRows, setDoneVisibleRows] = useState(0)
  const [epicVisibleRows, setEpicVisibleRows] = useState(0)

  // Partition once for use in handlers and render
  const { active: activeTasks, done: doneTasks } = partitionTasks(tasks)

  // Derive the currently selected task for detail view
  const selectedTask =
    focusedTable === "active"
      ? activeTasks[activeSelectedIndex] ?? null
      : focusedTable === "done"
        ? doneTasks[doneSelectedIndex] ?? null
        : null // Epic pane — no task selected

  // Derive the currently selected epic for epic actions
  const selectedEpic =
    focusedTable === "epic"
      ? epics[epicSelectedIndex] ?? null
      : null

  // Clamp focus when tasks change (covers all refresh paths: initial,
  // periodic, manual, and post-task).
  const prevTasksRef = useRef(tasks)
  const prevEpicsRef = useRef(epics)
  useEffect(() => {
    if (prevTasksRef.current !== tasks || prevEpicsRef.current !== epics) {
      prevTasksRef.current = tasks
      prevEpicsRef.current = epics
      const { active, done } = partitionTasks(tasks)
      setFocusState((prev) =>
        clampAfterRefresh(prev, active.length, done.length, activeVisibleRows, doneVisibleRows, epics.length, epicVisibleRows),
      )
    }
  }, [tasks, epics, activeVisibleRows, doneVisibleRows, epicVisibleRows])

  // Trigger refresh — fire-and-forget; the controller owns task data.
  const doRefresh = useCallback(() => {
    void onRefresh().catch(() => {
      // Error captured by controller in refreshError state.
    })
  }, [onRefresh])

  // Mark-ready pending IDs from the controller's Effect-native queue.
  // Falls back to an empty set when the controller does not provide one.
  const markingReadyIds = markReadyPendingIdsProp ?? emptySet
  const epicDeletingIds = epicDeletePendingIdsProp ?? emptySet

  // Keyboard handler — delegates to pure state transitions from dashboardFocus.ts
  const handleKeyboard = useCallback(
    (key: { name: string; shift?: boolean; ctrl?: boolean }) => {
      // Ctrl+Q quits from any view
      if (key.ctrl && key.name === "q") {
        onQuit?.()
        process.exit(0)
        return
      }

      // --- Detail-mode keys ---
      if (viewMode === "detail") {
        switch (key.name) {
          case "escape":
          case "backspace":
            onExitDetailView?.()
            setFocusState(returnFromDetail())
            return
          default:
            return
        }
      }

      // --- Dashboard-mode keys ---
      switch (key.name) {
        case "escape":
          onQuit?.()
          process.exit(0)
          break

        case "tab":
          setFocusState((prev) => toggleFocusedTable(prev))
          break

        case "up":
        case "k":
          setFocusState((prev) => {
            const vis = prev.focusedTable === "active" ? activeVisibleRows
              : prev.focusedTable === "done" ? doneVisibleRows
              : epicVisibleRows
            return moveSelectionUp(prev, vis)
          })
          break

        case "down":
        case "j":
          setFocusState((prev) => {
            const vis = prev.focusedTable === "active" ? activeVisibleRows
              : prev.focusedTable === "done" ? doneVisibleRows
              : epicVisibleRows
            return moveSelectionDown(prev, activeTasks.length, doneTasks.length, vis, epics.length)
          })
          break

        case "return":
        case "enter": {
          // Only task panes support detail drill-down
          if (focusedTable === "epic") break
          const taskToDetail =
            focusedTable === "active"
              ? activeTasks[activeSelectedIndex]
              : doneTasks[doneSelectedIndex]
          if (taskToDetail && onFetchTaskDetail) {
            onFetchTaskDetail(taskToDetail.id)
          }
          setFocusState((prev) => enterDetail(prev, activeTasks.length, doneTasks.length))
          break
        }

        case "r":
          doRefresh()
          break

        case "m":
          // Mark Ready action — task panes only
          if (
            onEnqueueMarkReady &&
            selectedTask &&
            getAvailableActions(selectedTask).includes("mark-ready") &&
            !markingReadyIds.has(selectedTask.id)
          ) {
            onEnqueueMarkReady(selectedTask.id, selectedTask.labels ?? [])
          }
          break

        case "d":
          // Delete Epic action — epic pane only, immediate, no confirmation
          if (
            onEnqueueEpicDelete &&
            focusedTable === "epic" &&
            selectedEpic &&
            selectedEpic.status !== "queued_for_deletion" &&
            !epicDeletingIds.has(selectedEpic.id)
          ) {
            onEnqueueEpicDelete(selectedEpic.id)
          }
          break

        default:
          break
      }
    },
    [viewMode, activeTasks.length, doneTasks.length, epics.length, onQuit, doRefresh, selectedTask, selectedEpic, activeVisibleRows, doneVisibleRows, epicVisibleRows, markingReadyIds, epicDeletingIds, onEnqueueMarkReady, onEnqueueEpicDelete, onFetchTaskDetail, onExitDetailView, focusedTable, activeSelectedIndex, doneSelectedIndex, epicSelectedIndex],
  )

  useKeyboard(handleKeyboard)

  // Determine context-sensitive footer hints
  const hasMarkReady =
    viewMode === "dashboard" &&
    (focusedTable === "active" || focusedTable === "done") &&
    selectedTask != null &&
    getAvailableActions(selectedTask).includes("mark-ready")

  const hasEpicDelete =
    viewMode === "dashboard" &&
    focusedTable === "epic" &&
    selectedEpic != null &&
    selectedEpic.status !== "queued_for_deletion"

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
      }}
    >
      <WatchHeader
        totalTasks={tasks.length}
        lastRefreshed={lastRefreshed}
        error={error}
        workerStatus={workerStatus}
        config={config}
      />

      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
        }}
      >
        {viewMode === "detail" ? (
          <DetailPane
            task={detailTaskProp ?? selectedTask}
            loading={detailLoadingProp}
            error={detailErrorProp}
          />
        ) : (
          <DashboardView
            tasks={tasks}
            epics={epics}
            focusedTable={focusedTable}
            activeSelectedIndex={activeSelectedIndex}
            doneSelectedIndex={doneSelectedIndex}
            epicSelectedIndex={epicSelectedIndex}
            activeScrollOffset={activeScrollOffset}
            doneScrollOffset={doneScrollOffset}
            epicScrollOffset={epicScrollOffset}
            terminalWidth={width}
            markingReadyIds={markingReadyIds as Set<string>}
            onActiveVisibleRowCountChange={setActiveVisibleRows}
            onDoneVisibleRowCountChange={setDoneVisibleRows}
            onEpicVisibleRowCountChange={setEpicVisibleRows}
          />
        )}
      </box>

      <WatchFooter
        viewMode={viewMode}
        hasMarkReady={hasMarkReady}
        hasEpicDelete={hasEpicDelete}
      />
    </box>
  )
}
