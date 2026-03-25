# Verification: Expose All Root package.json Scripts as Selectable Checks

**Date:** 2026-03-25
**Status:** PASS

## Summary

All acceptance criteria for the "all package.json scripts as check options" feature have been verified.

## Acceptance Criteria Verification

### 1. ralphe config shows all scripts from the root package.json as selectable check options
**PASS** - `detectProject()` iterates `Object.keys(scripts)` on the root package.json (line 68 of `src/detect.ts`), creating a `DetectedCheck` for every script entry. The config wizard in `cli.ts` maps all detected checks to checkbox choices. Verified functionally against the actual repo root: all 6 scripts (build, dev, lint, format, typecheck, test) are surfaced.

### 2. Root-only discovery boundary remains unchanged
**PASS** - `detectProject()` only reads `path.join(workDir, "package.json")` — no recursive directory traversal or workspace resolution. Test `"uses only root package scripts when nested workspace packages exist"` confirms nested `apps/web/package.json` scripts are ignored.

### 3. Package-manager-specific command rendering produces correct runnable commands
**PASS** - `renderCommand()` handles:
- `bun test` special case (uses `bun test` not `bun run test`)
- All other scripts use `{pm} run {scriptName}` pattern
- Tests cover npm, bun, pnpm, and yarn rendering

### 4. Verification-oriented scripts enabled by default; others shown but not auto-selected
**PASS** - `DEFAULT_ENABLED_SCRIPTS = new Set(["typecheck", "lint", "test"])` is documented with a JSDoc comment explaining the policy. Test `"default-enabled policy"` verifies exactly these three are enabled and all others (build, dev, format, db:seed) are disabled. Functional test against repo root confirms: typecheck, lint, test are `[x]`; build, dev, format are `[ ]`.

### 5. Persisted checks remain explicit array of shell commands; run/watch execute only stored checks
**PASS** - Config wizard stores selected commands as `string[]` in `checks` field. `saveConfig()` writes JSON. `loadConfig()` reads the array back. The `run` command builds `RunRequest.checks` from `cfg.checks` (cli.ts line 179) — no re-detection at runtime. `RalpheConfig.checks` type is `readonly string[]`.

### 6. Detection tests, wizard-choice mapping, and docs updated
**PASS** -
- **Detection tests** (11 tests): Cover all-scripts surfacing, default-enabled policy, root-only boundary, PM-specific rendering, bun special case, empty scripts field
- **Config tests** (15 tests): Cover load/save round-trip, defaults, git modes
- **README.md**: Documents that wizard shows "all root-level scripts", explains default-enabled policy, notes nested scripts are not discovered
- **Total test suite**: 695 tests pass, 0 failures

## Functional Verification

Ran `detectProject()` against the actual monorepo root (`/Users/terencek/Development/kfc-ts`):

```
Package Manager: pnpm
Language: TypeScript
Checks:
  [ ] pnpm run build
  [ ] pnpm run dev
  [x] pnpm run lint
  [ ] pnpm run format
  [x] pnpm run typecheck
  [x] pnpm run test
```

All 6 root scripts are surfaced. Only verification scripts are pre-selected.

## Test Results

```
695 pass, 0 fail, 1850 expect() calls
Ran 695 tests across 37 files. [6.38s]
```

## Key Implementation Files

| File | Role |
|------|------|
| `src/detect.ts` | Script discovery — iterates all root package.json scripts |
| `cli.ts` | Config wizard — maps detected checks to checkbox choices |
| `src/config.ts` | Config persistence — loads/saves checks as string array |
| `tests/detect.test.ts` | Detection contract tests (11 tests) |
| `tests/config.test.ts` | Config load/save tests (15 tests) |
| `README.md` | Updated documentation |
| `docs/prd-all-package-json-scripts-as-check-options.md` | PRD |
