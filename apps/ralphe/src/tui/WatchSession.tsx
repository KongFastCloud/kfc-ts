/** @jsxImportSource @opentui/react */
/**
 * ABOUTME: Watch-session React boundary — mounted once for the lifetime of
 * the TUI session. Subscribes to controller state changes from inside React
 * so the app tree updates through normal reconciliation rather than repeated
 * top-level root.render() calls. This preserves local dashboard state
 * (selection, scroll offset, view mode) across controller-driven updates.
 */

import type { ReactNode } from "react"
import { useState, useEffect, useCallback } from "react"
import type { TuiWatchController } from "../tuiWatchController.js"
import type { TuiWatchControllerState } from "../tuiWatchController.js"
import { loadConfig } from "../config.js"
import { WatchApp } from "./WatchApp.js"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WatchSessionProps {
  /** The controller that owns task data, worker status, and lifecycle. */
  controller: TuiWatchController
  /** Working directory — used to load config for the header. */
  workDir: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Single-mount session boundary for the watch TUI.
 *
 * Rendered once via `root.render(<WatchSession ... />)`. Controller state
 * changes are consumed through a React subscription (useState + onStateChange)
 * so that updates flow through normal React reconciliation. WatchApp and its
 * descendants retain their local state (focus, selection, scroll) across
 * background refreshes.
 */
export function WatchSession({ controller, workDir }: WatchSessionProps): ReactNode {
  // Seed state from the controller's current snapshot so the first render
  // is synchronous and matches what the controller already has.
  const [controllerState, setControllerState] = useState<TuiWatchControllerState>(
    () => controller.getState(),
  )

  // Subscribe to controller state changes. The listener simply snapshots
  // the controller's current state into React state, triggering a re-render
  // through normal reconciliation.
  useEffect(() => {
    const listener = () => {
      setControllerState(controller.getState())
    }
    controller.onStateChange(listener)

    // Clean up subscription on unmount.
    return () => {
      controller.removeStateChangeListener(listener)
    }
  }, [controller])

  // Stable callback references that delegate to the controller.
  const onRefresh = useCallback(
    () => controller.refresh().then(() => {}),
    [controller],
  )

  const onEnqueueMarkReady = useCallback(
    (id: string, labels: string[]) => controller.enqueueMarkReady(id, labels),
    [controller],
  )

  const onFetchTaskDetail = useCallback(
    (taskId: string) => {
      void controller.fetchTaskDetail(taskId)
    },
    [controller],
  )

  const onExitDetailView = useCallback(
    () => controller.exitDetailView(),
    [controller],
  )

  // Load config each render — matches previous behavior in the rerender() helper.
  const config = loadConfig(workDir)

  return (
    <WatchApp
      tasks={controllerState.latestTasks}
      error={controllerState.refreshError}
      lastRefreshed={controllerState.lastRefreshed}
      onRefresh={onRefresh}
      onEnqueueMarkReady={onEnqueueMarkReady}
      markReadyPendingIds={controllerState.markReadyPendingIds}
      workerStatus={controllerState.workerStatus}
      config={config}
      detailTask={controllerState.detailTask}
      detailLoading={controllerState.detailLoading}
      detailError={controllerState.detailError}
      onFetchTaskDetail={onFetchTaskDetail}
      onExitDetailView={onExitDetailView}
    />
  )
}
