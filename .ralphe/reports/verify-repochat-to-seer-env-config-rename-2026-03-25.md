# Verification: Rename REPOCHAT_* to SEER_* env/config contract

**Date:** 2026-03-25
**Status:** PASS

## Summary

The rename of product-scoped environment variables and config naming from `REPOCHAT_*` to `SEER_*` has been correctly implemented as a clean-break rename with no compatibility aliases.

## What was verified

### 1. No remaining REPOCHAT_ references in source code
- Grep for `REPOCHAT_` across `apps/seer/src/` returned **zero matches**
- All env var lookups now use the `SEER_*` prefix

### 2. Renamed environment variables
| Old Name | New Name | Files |
|----------|----------|-------|
| `REPOCHAT_TRACKED_BRANCH` | `SEER_TRACKED_BRANCH` | `src/config.ts`, `.env.example`, tests |
| `REPOCHAT_REPO_ROOT` | `SEER_REPO_ROOT` | `src/config.ts`, `.env.example`, tests |
| `REPOCHAT_MEMORY_DB_URL` | `SEER_MEMORY_DB_URL` | `src/memory.ts`, `.env.example`, tests |

### 3. Files changed (commit 9bdbe27)
- `apps/seer/src/config.ts` - Runtime env lookups updated
- `apps/seer/src/memory.ts` - DB URL env lookup updated
- `apps/seer/src/tools/read-file.ts` - Repo root env reference updated
- `apps/seer/.env.example` - Example env file updated
- `apps/seer/README.md` - Documentation updated
- 8 test files updated with new env var names

### 4. Tests pass
- **117 tests, 0 failures** across 28 suites
- Tests cover config resolution, codebase grounding, webhook adapters, read-file tool, startup, reindex worker, and memory integration

### 5. Clean-break confirmed
- No backward-compatible aliases for old `REPOCHAT_*` names
- No fallback logic to old names
- Consistent with the design requirement for a clean break

## Acceptance Criteria

- [x] Product-scoped env/config names use SEER_* instead of REPOCHAT_*
- [x] Runtime config lookups resolve the renamed env contract correctly
- [x] Env examples and setup docs reflect the new env names
- [x] The rename does not change runtime behavior beyond the config naming itself
