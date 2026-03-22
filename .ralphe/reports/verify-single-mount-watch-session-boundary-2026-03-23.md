# Verification: Single-Mount Watch Session Boundary

**Date:** 2026-03-23
**Status:** PASS

## Summary

Verified that the watch TUI renders through a single mounted `WatchSession` React boundary for the duration of a session, replacing the previous imperative re-render loop that called `root.render()` repeatedly from outside React.

## Changes Reviewed

### New file: `apps/ralphe/src/tui/WatchSession.tsx`
- New React component that acts as the single-mount session boundary.
- Seeds state from `controller.getState()` via `useState` initializer (synchronous first render).
- Subscribes to controller state changes via `useEffect` + `controller.onStateChange(listener)`.
- Cleans up subscription on unmount via `controller.removeStateChangeListener(listener)`.
- Uses stable `useCallback` refs for `onRefresh` and `onEnqueueMarkReady` to avoid unnecessary child re-renders.
- Delegates all rendering to `WatchApp` with controller state spread as props.

### Modified file: `apps/ralphe/src/watchTui.tsx`
- Removed the imperative `rerender()` helper that called `root.render(<WatchApp .../>)` on every state change.
- Removed the `controller.onStateChange(rerender)` subscription from outside React.
- Now calls `root.render(<WatchSession controller={controller} workDir={workDir} />)` exactly once.
- Imports `WatchSession` instead of `WatchApp` + `loadConfig`.

### Modified file: `apps/ralphe/src/tuiWatchController.ts`
- Added `removeStateChangeListener(listener)` to the `TuiWatchController` interface and implementation.
- Enables proper cleanup of the React subscription in `WatchSession`'s `useEffect` cleanup.

## Acceptance Criteria Verification

### 1. Single mounted app boundary for the duration of a session
**PASS** — `root.render()` is called exactly once in `watchTui.tsx` (line 88) with `<WatchSession>`. The previous pattern of calling `root.render(<WatchApp .../>)` on every state change is completely removed.

### 2. Controller state changes update without recreating local UI state
**PASS** — `WatchSession` uses `useState` + `useEffect` to subscribe to controller changes from inside React. State updates flow through normal React reconciliation, so `WatchApp` and its descendants (including dashboard focus/selection/scroll state) are preserved across updates.

### 3. Existing refresh triggers and controller lifecycle remain intact
**PASS** — The lifecycle sequence in `watchTui.tsx` is unchanged:
1. `ensureBeadsDatabase` → 2. `createTuiWatchController` → 3. `controller.initialLoad()` → 4. `controller.startMarkReadyConsumer()` → 5. mount renderer → 6. `controller.startWorker()` + `controller.startPeriodicRefresh()` → 7. block until quit.

No changes to the controller's refresh, worker, mark-ready consumer, or periodic refresh logic.

### 4. No polling, eventing, or workflow changes beyond the rendering boundary fix
**PASS** — The only changes are:
- New `WatchSession` component (rendering boundary).
- Replaced imperative re-render with single mount.
- Added `removeStateChangeListener` for cleanup.
- No new polling, event subscriptions, filesystem watchers, or workflow modifications.

## Test Results

- **TypeScript compilation:** Clean (no errors)
- **Full test suite:** 442 tests pass, 0 failures across 24 test files
- **Controller tests:** 14 tests pass, 29 assertions

## Non-Goals Verified

- No removal of periodic refresh — `startPeriodicRefresh()` still runs as before.
- No Beads event subscriptions or filesystem watchers introduced.
- No dashboard focus state moved into the controller — it remains local to `WatchApp`.
