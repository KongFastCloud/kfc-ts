# Verification Report: Expose measured visibleRowCount to parent for scroll clamping

**Date:** 2026-03-20
**Status:** PASS

## Summary

All acceptance criteria have been verified and the implementation is correct.

## Acceptance Criteria Verification

### 1. computeVisibleRowCounts function is deleted ✅
- No references to `computeVisibleRowCounts` exist in any `.ts`/`.tsx` source files
- Only remaining mentions are in previous verification report files (`.md`)
- Function fully removed from `DashboardView.tsx`

### 2. WatchApp receives measured row counts via callback from DashboardTable ✅
- `WatchApp.tsx:465-466`: State declarations `activeVisibleRows` and `doneVisibleRows` via `useState(0)`
- `WatchApp.tsx:631-632`: Callbacks `onActiveVisibleRowCountChange={setActiveVisibleRows}` and `onDoneVisibleRowCountChange={setDoneVisibleRows}` passed to `DashboardView`
- `DashboardView.tsx:563,578`: Callbacks forwarded to each `DashboardTable` as `onVisibleRowCountChange`
- `DashboardView.tsx:370`: Prop typed as `onVisibleRowCountChange?: (count: number) => void`
- `DashboardView.tsx:375-383`: useEffect fires callback when measured row count changes

### 3. Keyboard scroll clamping (up/down/j/k) uses measured row counts ✅
- `WatchApp.tsx:567`: moveSelectionUp uses `prev.focusedTable === "active" ? activeVisibleRows : doneVisibleRows`
- `WatchApp.tsx:575`: moveSelectionDown uses the same pattern
- `WatchApp.tsx:593`: Both `activeVisibleRows` and `doneVisibleRows` in dependency array of keyboard handler useCallback

### 4. clampAfterRefresh uses measured row counts ✅
- `WatchApp.tsx:489`: `clampAfterRefresh(prev, active.length, done.length, activeVisibleRows, doneVisibleRows)`
- `WatchApp.tsx:497`: Both values in dependency array of doRefresh callback

### 5. No regression in scroll/selection behavior ✅
- TypeScript compilation passes with no errors (`tsc --noEmit` clean)
- All 364 tests pass across 21 test files (851 expect() calls)
- `dashboardFocus.test.ts` passes, covering clampAfterRefresh and move selection logic

## Files Changed
- `apps/ralphe/src/tui/DashboardView.tsx` — Added `onVisibleRowCountChange` prop to DashboardTable, added `onActiveVisibleRowCountChange`/`onDoneVisibleRowCountChange` props to DashboardView, removed `computeVisibleRowCounts`
- `apps/ralphe/src/tui/WatchApp.tsx` — Added state for measured row counts, wired callbacks, updated key handlers and clampAfterRefresh, removed `computeVisibleRowCounts` import
