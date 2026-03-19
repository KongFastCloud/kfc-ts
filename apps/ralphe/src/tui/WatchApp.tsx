/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-mode TUI application component.
 * Renders a dashboard with two stacked tables (active / done) from
 * Beads data, with periodic refresh, keyboard navigation, and
 * loading/error states. The detail-view pane is retained for future
 * drill-down but is not rendered on the dashboard landing screen.
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import type { WatchTask, WatchTaskStatus } from "../beadsAdapter.js"
import type { WorkerStatus, WorkerLogEntry } from "../tuiWorker.js"
import { DashboardView, partitionTasks } from "./DashboardView.js"

// ---------------------------------------------------------------------------
// Theme (inline subset — avoids coupling to ralph-tui's theme package)
// ---------------------------------------------------------------------------

const colors = {
  bg: { primary: "#1a1b26", secondary: "#24283b", tertiary: "#2f3449", highlight: "#3d4259" },
  fg: { primary: "#c0caf5", secondary: "#a9b1d6", muted: "#565f89", dim: "#414868" },
  status: { success: "#9ece6a", warning: "#e0af68", error: "#f7768e", info: "#7aa2f7" },
  accent: { primary: "#7aa2f7", secondary: "#bb9af7", tertiary: "#7dcfff" },
  border: { normal: "#3d4259", active: "#7aa2f7", muted: "#2f3449" },
} as const

// Status theme used by DetailPane (retained for future detail-view slice)
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
// Types
// ---------------------------------------------------------------------------

export interface WatchAppProps {
  /** Initial task list (populated before first render). */
  initialTasks: WatchTask[]
  /** Async callback to refresh the task list. */
  onRefresh: () => Promise<WatchTask[]>
  /** Refresh interval in milliseconds. 0 disables auto-refresh. */
  refreshIntervalMs?: number
  /** Callback when the user quits. */
  onQuit?: () => void
  /** Optional error message to display. */
  initialError?: string | undefined
  /** Current worker status (idle/running). */
  workerStatus?: WorkerStatus | undefined
  /** Worker log entries to display in the log panel. */
  workerLogs?: WorkerLogEntry[] | undefined
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WatchHeader({
  totalTasks,
  lastRefreshed,
  error,
  workerStatus,
}: {
  totalTasks: number
  lastRefreshed: Date | null
  error: string | undefined
  workerStatus?: WorkerStatus | undefined
}): ReactNode {
  const timeStr = lastRefreshed
    ? lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—"

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

function WatchFooter(): ReactNode {
  const navShortcuts = "↑↓:Navigate  r:Refresh  q:Quit"
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: colors.bg.secondary,
        justifyContent: "flex-start",
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

function LogPanel({
  logs,
  maxHeight,
}: {
  logs: WorkerLogEntry[]
  maxHeight: number
}): ReactNode {
  // Show newest entries last (tail behavior)
  const visibleCount = Math.max(1, maxHeight - 2) // account for border
  const visibleLogs = logs.slice(-visibleCount)

  return (
    <box
      title="Worker Logs"
      style={{
        width: "100%",
        height: Math.min(maxHeight, Math.max(5, logs.length + 2)),
        flexDirection: "column",
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      <scrollbox style={{ flexGrow: 1, width: "100%" }}>
        {visibleLogs.length === 0 ? (
          <box style={{ paddingLeft: 1 }}>
            <text fg={colors.fg.muted}>No worker logs yet</text>
          </box>
        ) : (
          visibleLogs.map((entry, idx) => {
            const timeStr = entry.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
            const taskTag = entry.taskId
              ? ` [${entry.taskId}]`
              : ""
            return (
              <box key={idx} style={{ paddingLeft: 1, paddingRight: 1 }}>
                <text>
                  <span fg={colors.fg.dim}>{timeStr}</span>
                  {taskTag && <span fg={colors.accent.secondary}>{taskTag}</span>}
                  <span fg={colors.fg.secondary}> {entry.message}</span>
                </text>
              </box>
            )
          })
        )}
      </scrollbox>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Main WatchApp
// ---------------------------------------------------------------------------

export function WatchApp({
  initialTasks,
  onRefresh,
  refreshIntervalMs = 10_000,
  onQuit,
  initialError,
  workerStatus,
  workerLogs,
}: WatchAppProps): ReactNode {
  const { width, height } = useTerminalDimensions()
  const [tasks, setTasks] = useState<WatchTask[]>(initialTasks)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [error, setError] = useState<string | undefined>(initialError)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(
    initialTasks.length > 0 ? new Date() : null,
  )
  const refreshingRef = useRef(false)

  // Refresh callback
  const doRefresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    try {
      const updated = await onRefresh()
      setTasks(updated)
      setError(undefined)
      setLastRefreshed(new Date())
      // Clamp selection if list shrank
      const { active, done } = partitionTasks(updated)
      const newTotal = active.length + done.length
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, newTotal - 1)))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Refresh failed: ${msg}`)
    } finally {
      refreshingRef.current = false
    }
  }, [onRefresh])

  // Periodic auto-refresh
  useEffect(() => {
    if (refreshIntervalMs <= 0) return
    const timer = setInterval(() => {
      void doRefresh()
    }, refreshIntervalMs)
    return () => clearInterval(timer)
  }, [refreshIntervalMs, doRefresh])

  // Derive selected task — selection spans both dashboard tables
  const { active: activeTasks, done: doneTasks } = partitionTasks(tasks)
  const totalNavigable = activeTasks.length + doneTasks.length
  const selectedTask =
    selectedIndex < activeTasks.length
      ? activeTasks[selectedIndex] ?? null
      : doneTasks[selectedIndex - activeTasks.length] ?? null

  // Keyboard handler
  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      switch (key.name) {
        case "q":
        case "escape":
          onQuit?.()
          process.exit(0)
          break

        case "up":
        case "k":
          setSelectedIndex((prev) => Math.max(0, prev - 1))
          break

        case "down":
        case "j":
          setSelectedIndex((prev) => Math.min(totalNavigable - 1, prev + 1))
          break

        case "r":
          void doRefresh()
          break

        default:
          break
      }
    },
    [totalNavigable, onQuit, doRefresh],
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
      />

      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
        }}
      >
        <DashboardView
          tasks={tasks}
          selectedIndex={selectedIndex}
          terminalWidth={width}
        />
        {workerLogs !== undefined && (
          <LogPanel
            logs={workerLogs}
            maxHeight={Math.max(5, Math.floor(height * 0.25))}
          />
        )}
      </box>

      <WatchFooter />
    </box>
  )
}
