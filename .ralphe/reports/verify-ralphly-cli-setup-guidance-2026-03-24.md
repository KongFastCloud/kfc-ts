# Verification: Tighten CLI Setup Guidance for ralphly

**Date:** 2026-03-24
**Status:** PASS

## Summary

The CLI setup guidance for ralphly has been correctly implemented. All acceptance criteria are satisfied.

## Acceptance Criteria Verification

### 1. Missing-config and setup-related CLI output clearly points users toward the supported setup flow

**PASS**

- `ralphly config` with missing config shows:
  - "Missing required values:" with each missing field listed (✗ marker)
  - Each field shows both config key and env var name (e.g., `repoPath (env: RALPHLY_REPO_PATH)`)
  - Step-by-step guidance: copy `.env.example`, re-run `ralphly config`
  - Mentions `.ralphly/config.json` as alternative
  - Points to README for full setup guide

- `ralphly run` with missing config shows:
  - "Missing required configuration:" with all missing fields
  - Same step-by-step guidance pointing to `.env.example` and `ralphly config`
  - References README for full guide
  - Exits with error code 1 (FatalError)

### 2. CLI guidance is consistent with the README and .env.example

**PASS**

- `.env.example` documents all 3 required env vars: `RALPHLY_REPO_PATH`, `LINEAR_API_KEY`, `LINEAR_AGENT_ID`
- README documents the same 3 required values with both env var and config file paths
- CLI error messages reference the exact same env var names
- CLI `config` subcommand output matches README example (same format with source hints)
- Precedence rules (env > config file > defaults) documented in README and implemented in `config.ts`
- The recommended flow (config → dry-run → run) is consistent across CLI comments, README, and error guidance

### 3. The slice improves first-run usability without redesigning the config system

**PASS**

- Config loading remains a simple env-or-file resolution with discriminated union return type
- No new config system or init workflow was introduced
- Error messages collect all missing fields at once (not fail-fast) for better UX
- `describeSource()` helper shows where each value came from (env vs config file)
- The `config` subcommand provides a complete verification step before running

### 4. No full init flow is added unless strictly necessary

**PASS**

- No `ralphly init` command exists
- `saveConfig()` utility exists in config.ts but is not wired to any CLI command
- Setup guidance directs users to manually copy `.env.example` or create config file
- This is appropriate given the narrow scope requirement

## Test Results

- **Config tests:** 7/7 passed (validation, env precedence, mixed sources)
- **All tests:** 220/220 passed across 10 test files
- **TypeScript:** Compiles cleanly (no errors)
- **Lint:** 0 errors (12 warnings, all unused imports in test files)

## CLI Output Verification

### Missing config scenario (`ralphly config`):
```
─── Configuration (incomplete) ───

Missing required values:
  ✗ repoPath (env: RALPHLY_REPO_PATH)
  ✗ linear.apiKey (env: LINEAR_API_KEY)
  ✗ linear.agentId (env: LINEAR_AGENT_ID)

To get started:
  1. Copy .env.example to .env and fill in your values
  2. Re-run 'ralphly config' to verify

You can also set values in .ralphly/config.json (env vars take precedence).
See the README for the full setup guide.
```

### Complete config scenario (`ralphly config`):
```
─── Configuration ───

  Repo path:    /tmp
                (from env: RALPHLY_REPO_PATH)
  Agent ID:     test-agent
                (from env: LINEAR_AGENT_ID)
  API key:      lin_api_...
                (from env: LINEAR_API_KEY)
  Max attempts: 2
  Checks:       (none)

Configuration is complete. Ready to run.
```

### Missing config scenario (`ralphly run --dry-run`):
Exits with FatalError listing missing fields and same setup guidance.

## Files Reviewed

- `apps/ralphly/cli.ts` - CLI entry point with config and run subcommands
- `apps/ralphly/src/config.ts` - Config loading with env precedence
- `apps/ralphly/src/errors.ts` - FatalError type
- `apps/ralphly/.env.example` - Environment variable template
- `apps/ralphly/README.md` - Setup documentation
- `apps/ralphly/tests/config.test.ts` - Config test suite
