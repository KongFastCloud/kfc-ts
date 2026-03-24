# Verification: ralphly README and first-run setup guide

**Date:** 2026-03-24
**Task:** Add ralphly README and first-run setup guide
**Result:** PASS

## Acceptance Criteria Verification

### 1. ralphly has a dedicated setup doc or README ✅
- `apps/ralphly/README.md` exists (170 lines)
- Comprehensive, well-structured Markdown document

### 2. The doc explains what ralphly is, how to configure it, and how to run it manually ✅
- **What it is:** Line 3 — "A Linear-aware CLI worker that drains delegated work items from Linear and processes them through AI blueprints"
- **How to configure:** Configuration section (lines 75-128) with required/optional values tables, env var examples, and config file format
- **How to run:** Commands section (lines 23-73) documents `config`, `run --dry-run`, and `run` with example output and readiness/exit-reason tables

### 3. The doc explains the relationship between environment variables and .ralphly/config.json ✅
- Precedence section (lines 120-128) explicitly states: "environment variables win"
- Three-tier resolution order documented: env vars → config file → defaults
- Both mechanisms shown with examples
- `ralphly config` recommended to inspect resolved sources

### 4. A first-time user can follow the doc to reach a successful config or run --dry-run outcome ✅
- Quick start section (lines 5-21) provides 4-step flow: set env vars → config → dry-run → run
- "Verifying your setup" section (lines 130-142) reinforces the safe verification flow
- Both commands confirmed read-only and safe to repeat

## Code Alignment Verification

| README Claim | Code Reality | Match |
|---|---|---|
| Required: RALPHLY_REPO_PATH, LINEAR_API_KEY, LINEAR_AGENT_ID | config.ts lines 109-111, 116-119 | ✅ |
| Config file at .ralphly/config.json | config.ts lines 40-41, 52-53 | ✅ |
| Defaults: maxAttempts=2, checks=[] | config.ts lines 43-46 | ✅ |
| Env vars override config file | config.ts line 83 (envOr function) | ✅ |
| Readiness: actionable, blocked, error-held, ineligible, terminal | readiness.ts line 37 | ✅ |
| Exit reasons: no_candidates, no_actionable, backlog_drained, iteration_limit | cli.ts lines 20-23 | ✅ |
| Config file JSON structure | Matches RawConfigFile interface (config.ts lines 55-63) | ✅ |

## Runtime Verification

- **Typecheck:** `bun run typecheck` — passed (exit code 0)
- **Config tests:** 7/7 passed, 23 expect() calls
- **CLI `config` (no env vars):** Correctly reports 3 missing required values with guidance
- **CLI `config` (with env vars):** Shows resolved values with correct source attribution, reports "Configuration is complete. Ready to run."
- **Output format:** Matches the example output shown in the README

## Summary

The README is complete, accurate, and well-aligned with the implementation. A first-time user can follow the quick start to configure ralphly and verify their setup using the documented safe commands (`config` and `run --dry-run`). All claims in the documentation were verified against both the source code and actual CLI output.
