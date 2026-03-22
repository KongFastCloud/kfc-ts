/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-mode TUI application component.
 * Renders a two-view flow: a dashboard landing screen with two stacked
 * tables (active / done) and a detail drill-down view for inspecting a
 * single task. Enter navigates from dashboard to detail; Esc/Backspace
 * returns to dashboard. No worker log panel is rendered.
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import type { WatchTask, WatchTaskStatus } from "../beadsAdapter.js"
import { getAvailableActions } from "../beadsAdapter.js"
import type { RalpheConfig, GitMode } from "../config.js"
import type { WorkerStatus } from "../tuiWorker.js"
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

  const timeStr = lastRefreshed
    ? lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—"

  // Measure whether config section fits.
  // Left section: "◉ ralphe watch" = ~14 chars + possible error
  // Right section: worker status + tasks + time ≈ varies, estimate ~30
  // Config section: the formatted string
  // Padding: 2 (paddingLeft+Right) + gaps
  const configStr = config ? formatConfigSummary(config) : null
  const leftMinWidth = 15 + (error ? Math.min(error.length + 3, 63) : 0)
  const rightMinWidth = 30
  const configWidth = configStr ? configStr.length + 4 : 0 // +4 for surrounding gaps
  const showConfig = configStr != null && termWidth >= leftMinWidth + configWidth + rightMinWidth

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
        {error && (
          <text>
            <span fg={colors.status.error}> ⚠ {truncate(error, 60)}</span>
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
            {workerStatus.currentTaskId && (
              <span fg={colors.accent.secondary}> [{workerStatus.currentTaskId}]</span>
            )}
          </text>
        )}
        <text fg={colors.fg.secondary}>{totalTasks} tasks</text>
        <text fg={colors.fg.muted}>⏱ {timeStr}</text>
      </box>
    </box>
  )
}

function WatchFooter({ viewMode, hasMarkReady }: { viewMode: "dashboard" | "detail"; hasMarkReady?: boolean }): ReactNode {
  const navShortcuts =
    viewMode === "detail"
      ? "Esc/Backspace:Back  ^Q:Quit"
      : `↑↓:Navigate  Tab:Switch Table  Enter:Detail  r:Refresh${hasMarkReady ? "  m:Mark Ready" : ""}  ^Q:Quit`
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
      <text fg={colors.fg.muted}>{navShortcuts}</text>
    </box>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return text.slice(0, max - 1) + "…"
}

function DetailPane({ task }: { task: WatchTask | null }): ReactNode {
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
  error,
  lastRefreshed,
  onRefresh,
  onQuit,
  workerStatus,
  config,
  onEnqueueMarkReady,
  markReadyPendingIds: markReadyPendingIdsProp,
}: WatchAppProps): ReactNode {
  const { width } = useTerminalDimensions()

  // Dashboard focus and per-table selection state (single source of truth)
  const [focusState, setFocusState] = useState(initialDashboardFocusState)
  const { focusedTable, activeSelectedIndex, doneSelectedIndex, activeScrollOffset, doneScrollOffset, viewMode } = focusState

  // Measured visible row counts from DashboardTable (updated via callbacks)
  const [activeVisibleRows, setActiveVisibleRows] = useState(0)
  const [doneVisibleRows, setDoneVisibleRows] = useState(0)

  // Partition once for use in handlers and render
  const { active: activeTasks, done: doneTasks } = partitionTasks(tasks)

  // Derive the currently selected task for detail view
  const selectedTask =
    focusedTable === "active"
      ? activeTasks[activeSelectedIndex] ?? null
      : doneTasks[doneSelectedIndex] ?? null

  // Clamp focus when tasks change (covers all refresh paths: initial,
  // periodic, manual, and post-task).
  const prevTasksRef = useRef(tasks)
  useEffect(() => {
    if (prevTasksRef.current !== tasks) {
      prevTasksRef.current = tasks
      const { active, done } = partitionTasks(tasks)
      setFocusState((prev) =>
        clampAfterRefresh(prev, active.length, done.length, activeVisibleRows, doneVisibleRows),
      )
    }
  }, [tasks, activeVisibleRows, doneVisibleRows])

  // Trigger refresh — fire-and-forget; the controller owns task data.
  const doRefresh = useCallback(() => {
    void onRefresh().catch(() => {
      // Error captured by controller in refreshError state.
    })
  }, [onRefresh])

  // Mark-ready pending IDs from the controller's Effect-native queue.
  // Falls back to an empty set when the controller does not provide one.
  const markingReadyIds = markReadyPendingIdsProp ?? emptySet

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
            const vis = prev.focusedTable === "active" ? activeVisibleRows : doneVisibleRows
            return moveSelectionUp(prev, vis)
          })
          break

        case "down":
        case "j":
          setFocusState((prev) => {
            const vis = prev.focusedTable === "active" ? activeVisibleRows : doneVisibleRows
            return moveSelectionDown(prev, activeTasks.length, doneTasks.length, vis)
          })
          break

        case "return":
        case "enter":
          setFocusState((prev) => enterDetail(prev, activeTasks.length, doneTasks.length))
          break

        case "r":
          doRefresh()
          break

        case "m":
          // Mark Ready action — enqueue into the controller's Effect-native queue
          if (
            onEnqueueMarkReady &&
            selectedTask &&
            getAvailableActions(selectedTask).includes("mark-ready") &&
            !markingReadyIds.has(selectedTask.id)
          ) {
            onEnqueueMarkReady(selectedTask.id, selectedTask.labels ?? [])
          }
          break

        default:
          break
      }
    },
    [viewMode, activeTasks.length, doneTasks.length, onQuit, doRefresh, selectedTask, activeVisibleRows, doneVisibleRows, markingReadyIds, onEnqueueMarkReady],
  )

  useKeyboard(handleKeyboard)

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
          <DetailPane task={selectedTask} />
        ) : (
          <DashboardView
            tasks={tasks}
            focusedTable={focusedTable}
            activeSelectedIndex={activeSelectedIndex}
            doneSelectedIndex={doneSelectedIndex}
            activeScrollOffset={activeScrollOffset}
            doneScrollOffset={doneScrollOffset}
            terminalWidth={width}
            markingReadyIds={markingReadyIds as Set<string>}
            onActiveVisibleRowCountChange={setActiveVisibleRows}
            onDoneVisibleRowCountChange={setDoneVisibleRows}
          />
        )}
      </box>

      <WatchFooter
        viewMode={viewMode}
        hasMarkReady={
          viewMode === "dashboard" &&
          selectedTask != null &&
          getAvailableActions(selectedTask).includes("mark-ready")
        }
      />
    </box>
  )
}
