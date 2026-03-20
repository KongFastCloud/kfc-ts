# Verification Report: ralphe README Usage and Watch Mode Documentation

**Date:** 2026-03-20
**Task:** Update ralphe README usage and watch mode documentation
**Result:** PASS ✅

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `## Usage` code block no longer references `--engine` on `ralphe watch` | ✅ PASS | Line 46: `ralphe watch --interval 30` (was `ralphe watch --engine codex --interval 30`) |
| 2 | TUI keys section lists all bindings: q/Escape/Ctrl+Q, r, j/k/arrows, Tab, m, Enter, Backspace | ✅ PASS | Lines 160-166 list all required bindings |
| 3 | Mark-ready feature documented with eligibility rules (backlog, blocked, error only) | ✅ PASS | Lines 113-115: "Mark Ready" subsection with eligibility and FIFO queue |
| 4 | Dirty worktree guard behavior documented | ✅ PASS | Line 107: Dirty worktree guard bullet point |
| 5 | Stale task recovery on startup documented | ✅ PASS | Line 108: Stale task recovery bullet point |
| 6 | Session comment logging after agent execution documented | ✅ PASS | Line 109: Session comment logging bullet point |
| 7 | Retry error feedback (previous error in prompt) documented | ✅ PASS | Line 110: Retry error feedback bullet point |
| 8 | Structured CI failure annotations documented | ✅ PASS | Line 111: Structured CI failure annotations bullet point |
| 9 | Detail view sections enumerated | ✅ PASS | Lines 119-132: Detail View subsection with all sections listed |
| 10 | Config summary in TUI header mentioned | ✅ PASS | Line 99: TUI header config summary sentence |
| 11 | No changes to sections outside Usage and Beads Watch Mode | ✅ PASS | Git diff shows only 3 hunks, all within Usage and Beads Watch Mode sections |

## Diff Summary

Three hunks modified:
1. **Usage section (line 42-48):** Removed `--engine codex` from `ralphe watch` example, updated comment
2. **Beads Watch Mode (lines 96-140):** Added config summary, critical usage notes (5 items), Mark Ready subsection, Detail View subsection
3. **TUI keys (lines 157-166):** Expanded key bindings from 4 to 7 entries

## Notes

- The `--engine` flag remains documented on `ralphe run` (line 34), which is correct per the task spec
- The Watch TUI Status Mapping table and notes block were NOT modified, as required
- All other sections (Config, How It Works, Monorepos, Report, Engines, Errors) are untouched
