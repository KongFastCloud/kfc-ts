# Verification Report: Make header and footer terminal-width safe

**Date:** 2026-03-26
**Task:** Make header and footer terminal-width safe
**Parent Epic:** kfc-ts-kko7
**Status:** PASS

---

## Summary

The watch TUI header and footer have been made terminal-width safe. The implementation introduces explicit width budgeting for both header and footer, with safety margins to absorb emoji rendering differences and rounding drift. All acceptance criteria are met.

---

## Acceptance Criteria Verification

### 1. Footer/help text never renders past the terminal width
**PASS**

- `buildFooterText()` (exported, testable) computes safe width as `termWidth - 2 (padding) - FOOTER_SAFETY_MARGIN (2)` and truncates via `truncate()`.
- Test `watchChrome.test.ts` sweeps widths 5–200 and asserts `text.length + 2 <= termWidth` for every width.
- Edge case: `termWidth=0` returns empty string.

### 2. Header content degrades gracefully under narrow widths without causing right-edge clipping
**PASS**

- `computeHeaderRightWidth()` precisely measures the right section (worker status, task count, time).
- `computeHeaderErrorBudget()` derives error message budget from `contentWidth - leftFixed - rightWidth - configWidth - HEADER_SAFETY_MARGIN`, clamped to `Math.max(0, ...)`.
- Config section (`showConfig`) is only rendered when there is enough room: `contentWidth >= leftFixed + configWidth + rightWidth + HEADER_SAFETY_MARGIN`.
- Error message is hidden entirely when `errorBudget === 0`.
- Worker task IDs are truncated to 16 chars max.

### 3. Truncation or omission behavior is deterministic and consistent with existing TUI style
**PASS**

- `truncate()` function: returns full text if it fits, otherwise `text.slice(0, max-1) + "…"`.
- Config section: binary show/hide based on width check (deterministic).
- Error message: dynamic budget or hidden entirely (deterministic).

### 4. The fix does not regress the normal wide-terminal presentation
**PASS**

- At wide widths (120+), all header sections render fully: label, error, config, worker status, task count, time.
- Footer includes all shortcuts at wide widths (verified by test checking for all shortcut labels at `termWidth=200`).
- Dashboard pane width tests (52 tests) and focus tests (94 tests) all pass.

---

## Test Results

| Test Suite | Tests | Pass | Fail |
|---|---|---|---|
| `watchChrome.test.ts` (new) | 20 | 20 | 0 |
| `dashboard.test.ts` | 52 | 52 | 0 |
| `dashboardFocus.test.ts` | 94 | 94 | 0 |
| **Total** | **166** | **166** | **0** |

**TypeScript validation:** Clean (no errors)

---

## Implementation Details

### Files Changed
- `apps/ralphe/src/tui/WatchApp.tsx` — Header and footer width-safety logic (101 insertions, 16 deletions)

### Files Added
- `apps/ralphe/tests/watchChrome.test.ts` — 20 tests covering header/footer width invariants

### Key Constants
- `HEADER_SAFETY_MARGIN = 4` — absorbs emoji double-width and rounding
- `FOOTER_SAFETY_MARGIN = 2` — absorbs arrow glyph width and rounding
- `MAX_TASK_ID_DISPLAY = 16` — caps worker task ID display length

### Key Functions (exported for testing)
- `computeHeaderRightWidth()` — measures header right section width
- `computeHeaderErrorBudget()` — derives error message width budget
- `buildFooterText()` — builds and truncates footer shortcut text

---

## Notes

- Changes are implemented but not yet committed (unstaged modifications + untracked test file).
- The implementation correctly focuses on header/footer chrome only, not table columns (which are handled by the parent epic's pane width budgeting).
- Safety margins are conservative enough to handle emoji rendering variations while preserving information density at standard terminal widths.
