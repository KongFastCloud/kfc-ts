# Verification: .env.example and Config Precedence for ralphly

**Date:** 2026-03-24
**Slice:** Add .env.example and document config precedence for ralphly
**Result:** PASS

## Acceptance Criteria

### 1. apps/ralphly/.env.example exists and includes the supported environment keys
**PASS**

File exists at `apps/ralphly/.env.example` and includes all three supported environment variables:
- `RALPHLY_REPO_PATH` — Absolute path to the repository workspace
- `LINEAR_API_KEY` — Linear API key for SDK authentication
- `LINEAR_AGENT_ID` — Linear agent ID that ralphly operates as

The file also includes a header explaining how to use it and a note that env vars override `.ralphly/config.json`.

### 2. The example file matches the variables the implementation actually reads
**PASS**

`src/config.ts` reads exactly three environment variables via `envOr()`:
- `RALPHLY_REPO_PATH` (line 109)
- `LINEAR_API_KEY` (line 110)
- `LINEAR_AGENT_ID` (line 111)

These are the same three variables listed in `.env.example`. No extra variables are present in either direction.

### 3. The docs explicitly state that environment variables override .ralphly/config.json
**PASS**

The README contains a dedicated **Precedence** section (line 122-129) that states:

> When a value is set in both places, **environment variables win**. The full resolution order is:
> 1. **Environment variables** (highest priority)
> 2. **Config file** (`.ralphly/config.json`)
> 3. **Defaults** (for `maxAttempts` and `checks` only)

The `.env.example` file also states on line 6: "Environment variables override values in .ralphly/config.json."

The implementation confirms this — `envOr()` checks `process.env[envKey]` first and falls back to `fileValue`.

### 4. The slice does not introduce new required configuration beyond the current supported contract
**PASS**

The required values are the same three that have always existed:
- `repoPath` / `RALPHLY_REPO_PATH`
- `linear.apiKey` / `LINEAR_API_KEY`
- `linear.agentId` / `LINEAR_AGENT_ID`

Optional values remain `maxAttempts` (default: 2) and `checks` (default: []). No new configuration knobs were added.

## Test Results

All 7 config tests pass (23 assertions):
```
bun test v1.3.9
 7 pass
 0 fail
 23 expect() calls
Ran 7 tests across 1 file. [23.00ms]
```

Key test coverage:
- Config loading from file
- Env var overrides over config file values
- Env vars alone are sufficient (no config file needed)
- Missing field validation reports all missing fields at once
- Config path resolution
- Config file save/create

## Consistency Check

| Source | RALPHLY_REPO_PATH | LINEAR_API_KEY | LINEAR_AGENT_ID |
|--------|:-:|:-:|:-:|
| config.ts (implementation) | ✅ | ✅ | ✅ |
| .env.example | ✅ | ✅ | ✅ |
| README required values table | ✅ | ✅ | ✅ |
| README quick start | ✅ | ✅ | ✅ |
| config.test.ts | ✅ | ✅ | ✅ |

All sources are in agreement.
