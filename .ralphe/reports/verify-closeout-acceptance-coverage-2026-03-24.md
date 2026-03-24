# Verification Report: Close-out Acceptance Coverage for Linear-Backed Worker Model

**Date:** 2026-03-24
**Status:** ✅ PASS

## Summary

The close-out acceptance coverage for the Linear-backed worker model is correctly implemented. All 220 tests pass across 10 files (ralphly: 220 tests, blueprints: 28 tests), with the acceptance test file (`apps/ralphly/tests/acceptance.test.ts`, 1302 lines) providing comprehensive end-to-end coverage across all five acceptance criteria areas.

## Test Execution Results

```
ralphly: 220 pass, 0 fail, 529 expect() calls across 10 files [154ms]
blueprints: 28 pass, 0 fail, 53 expect() calls across 5 files [153ms]
```

## Acceptance Criteria Verification

### ✅ 1. Blueprints contract alignment (lines 182–373)
The acceptance tests prove the documented blueprints contract matches implementation:
- **Success result shape**: `success=true`, `attempts=1`, `resumeToken` propagated
- **Failure result shape**: `success=false`, exhausted attempts count, error + failureSummary present
- **Feedback propagation**: Failure feedback from attempt N is appended to the prompt in attempt N+1 (verified via engine prompt tracking)
- **Lifecycle event sequence**: `attempt_start → check_failed → attempt_start → success` matches documented order
- **Fatal error bypass**: `FatalError` propagates immediately without retry (engine called exactly once)
- **Retry feedback prepending**: `retryFeedback` from same-session follow-up is included in task input as "Previous Attempt Feedback"

### ✅ 2. Linear-backed readiness and queueing (lines 375–611)
The acceptance tests prove backlog selection is Linear-derived and respects the tightened readiness model:
- **Full mixed-readiness backlog**: 6 issues classified entirely from Linear state — terminal(1), ineligible(1), blocked(1), error-held(1), actionable(2)
- **Backlog/Triage ineligibility**: Issues in Backlog/Triage workflow categories remain ineligible regardless of priority or delegation
- **Activity-derived error-held**: Session status "active" + activity-detected error still gates readiness
- **Priority ordering**: Linear priority (lower number = higher) → FIFO (earliest created) verified
- **Blocked issue skip**: Blocked issues skipped, lower-priority unblocked issues selected instead
- **Classification precedence**: terminal > ineligible > error-held > blocked > actionable verified

### ✅ 3. Durable failure holds across fresh manual invocations (lines 614–795)
The acceptance tests prove error-held state persists across process restarts:
- **Error activity as durable marker**: Runner-written error activity is detectable by `isErrorActivity`, timestamp extractable by `findLastErrorTimestamp`
- **Fresh invocation reconstruction**: Both session-status "error" and activity-derived errorHeldIds paths classify correctly
- **Hold persistence**: Time alone does not clear a hold; only a "prompt"-type follow-up after the error timestamp clears it
- **Error summary preservation**: `findLastErrorSummary` correctly extracts the failure summary for retry feedback reconstruction
- **Multiple error cycles**: Only the last unresolved error creates a hold; earlier resolved errors don't interfere

### ✅ 4. Session-write contract and same-session retry (lines 798–1048)
The acceptance tests prove session updates match the documented operator contract:
- **Success path**: Writes exactly start → success (2 activities)
- **Failure path**: Writes exactly start → error (2 activities), error activity IS the durable hold marker
- **Retry+success path**: Writes start → check_failed → success (3 activities)
- **Retry+failure path**: Writes start → check_failed → error (3 activities)
- **Session targeting**: All activities correctly target the session ID from CandidateWork
- **Same-session retry flow**: Full data flow verified — error detection → follow-up detection → combined feedback construction → task input building
- **Activity format round-trip**: write → detect → classify cycle works correctly; success/start activities are NOT misdetected as errors
- **Event mapping**: `mapLoopEventToActivity` only maps `check_failed` events (not attempt_start or success)

### ✅ 5. Manual backlog draining (lines 1051–1301)
The acceptance tests prove the drain loop matches documented behavior:
- **Drains all actionable**: 2 actionable items processed in priority order, blocked and terminal items skipped
- **Continues past failures**: 3-issue drain with middle failure — first and third succeed, second fails, all get start activities
- **Stops when no actionable work remains**: After processing actionable item, selection returns null with correct non-actionable breakdown
- **Error-held retry integration**: Error-held issue becomes retryable after follow-up, with combined feedback correctly constructed
- **Operator-visible summary**: `formatBacklogSummary` includes total count, per-category counts, next item, and skip reasons for all non-actionable items

## Architecture Alignment with PRD

The implementation correctly follows the PRD's design decisions:
- **Linear as source of truth**: Backlog derived from Linear state, not private queue; error-held state reconstructed from Linear session activities
- **Blueprints as shared runner**: Tracker-agnostic, caller-prepared task input, retry loop with feedback propagation
- **Manual CLI worker**: Fresh invocation semantics, no long-lived process dependency
- **Durable semantics**: Error activities double as hold markers, surviving process restarts
- **Session-write contract**: Explicit mapping from runner state to Linear session updates

## Conclusion

The acceptance coverage comprehensively proves the tightened blueprints + ralphly model is ready for the later ralphe migration. The test suite validates all five documented areas at an end-to-end level, exercising real worker semantics rather than isolated helper functions. The implementation is aligned with the PRD and the team can confidently treat the ralphe migration as an integration step.
