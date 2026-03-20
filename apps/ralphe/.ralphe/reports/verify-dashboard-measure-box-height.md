# Verification Report: Measure Box Height in DashboardTable

**Date:** 2026-03-20
**Status:** PASS

## Acceptance Criteria Verification

### 1. DashboardTable no longer accepts visibleRowCount as a prop
**PASS** - The `DashboardTable` component props interface (DashboardView.tsx lines 351-369) does not include `visibleRowCount`. Props are: `title`, `tasks`, `selectedIndex`, `scrollOffset`, `titleWidth`, `flexGrow`, `borderColor`, `variant`.

### 2. DashboardTable measures its own box height via ref and derives row count
**PASS** - Implementation at lines 370-378:
- `useRef<BoxRenderable>(null)` creates a ref for the outer `<box>` element
- `useState(0)` initializes `visibleRowCount` to 0 (first frame shows 0 rows — acceptable per spec)
- `useEffect` (no deps — runs every render) reads `boxRef.current?.getLayoutNode()?.getComputedHeight()` and derives: `Math.max(0, measuredHeight - TABLE_CHROME_LINES)`
- `BoxRenderable` is imported from `@opentui/core` (line 13)
- The ref is attached to the outer `<box>` via `ref={boxRef}` (line 385)

### 3. Done table renders rows filling its available box space
**PASS** - The Done table `DashboardTable` instance (lines 575-588) uses `flexGrow={1}` and internally measures its actual rendered height to determine how many rows to show, rather than relying on a hardcoded 2:1 ratio calculation.

### 4. Active table renders rows filling its available box space
**PASS** - The Active table `DashboardTable` instance (lines 561-574) uses `flexGrow={2}` and internally measures its actual rendered height via the same `useRef`/`useEffect` mechanism.

### 5. Tables adjust row count on terminal resize
**PASS** - The `useEffect` has no dependency array, so it runs after every render. Terminal resize triggers `useTerminalDimensions()` in WatchApp, causing a re-render cascade that reaches DashboardTable, which re-measures and updates `visibleRowCount`.

## Implementation Details

- `TABLE_CHROME_LINES = 4` is used correctly (border top + border bottom + section title + column header)
- Each row is height 1, so no row-height divisor is needed
- `visibleSlice` at line 381 correctly uses: `tasks.slice(scrollOffset, scrollOffset + visibleRowCount)`
- Edge case: `measuredHeight < TABLE_CHROME_LINES` → `visibleRowCount = 0` via `Math.max(0, ...)`
- Edge case: `measuredHeight = 0` on first frame → `visibleRowCount = 0`, corrects on next frame

## Build & Test Results

- **TypeScript**: Compiles cleanly with `tsc --noEmit` (zero errors)
- **dashboard.test.ts**: 33/33 tests pass (55 expect calls)
- **dashboardFocus.test.ts**: 100/100 tests pass (332 expect calls)

## Note on WatchApp

WatchApp.tsx still imports `computeVisibleRowCounts` and uses the hardcoded 2:1 ratio for keyboard navigation state management (scroll offset clamping, selection movement). This is outside the scope of the current task, which focused on DashboardTable's rendering. The navigation logic in WatchApp operates independently and may benefit from a future update to read actual visible row counts from DashboardTable, but this is not required by the current acceptance criteria.
