# Verification Report: Include Previous Error in Agent Prompt on Retry

**Date:** 2026-03-20
**Status:** PASS

## Summary

The feature correctly reads the previous error from metadata before overwriting it and appends a `## Previous Error` section to the agent prompt when retrying an errored task.

## Implementation Verified

### tuiWorker.ts (lines 158-185)
- **Lines 158-165:** Reads existing metadata via `readMetadata(issue.id)` and extracts `previousError` from `existingMeta?.error`, wrapped in try/catch for resilience.
- **Lines 167-179:** Writes fresh `startMetadata` (without error field), overwriting the old metadata. This happens AFTER the read, preserving the ordering requirement.
- **Lines 182-185:** Builds prompt via `buildPromptFromIssue(issue)`, then conditionally appends `\n\n## Previous Error\n${previousError}` if `previousError` is truthy.

### watcher.ts (lines 107-125)
- Identical logic using Effect patterns (`yield* Effect.either(readMetadata(...))`) instead of try/catch.
- Same conditional prompt append pattern.

### beads.ts (line 27)
- `BeadsMetadata` interface includes `error?: string | undefined` field.

## Acceptance Criteria Verification

| Criteria | Status | Evidence |
|----------|--------|----------|
| Agent prompt includes Previous Error section when retrying an errored task | PASS | Test at line 796 verifies prompt contains `## Previous Error` and error message |
| Agent prompt does not include Previous Error for fresh tasks | PASS | Test at line 824 verifies prompt does NOT contain `## Previous Error` when no metadata |
| Previous error is read from metadata before metadata is overwritten | PASS | Test at line 870 verifies readMetadata call index < writeMetadata call index |
| Agent can use the error context to fix the issue | PASS | Error content is appended verbatim to prompt, giving agent full context |

## Test Results

- **24/24 tests pass** in `watchLifecycle.test.ts`
- **0 failures**
- **TypeScript typecheck passes** with no errors

### Specific tests for this feature:
1. `prompt includes Previous Error section when retrying an errored task` - PASS
2. `prompt does not include Previous Error for fresh tasks` - PASS
3. `prompt does not include Previous Error when metadata exists but has no error` - PASS
4. `previous error is read from metadata before metadata is overwritten` - PASS
