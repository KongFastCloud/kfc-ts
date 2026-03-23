# Verification Report: Ralphly CLI Skeleton and Config

**Date:** 2026-03-24
**Task:** Add ralphly CLI skeleton and config for manual Linear runs
**Result:** PASS

## Acceptance Criteria Verification

### 1. A new ralphly app exists in the monorepo
**PASS** - `apps/ralphly/` exists with a complete structure:
- `cli.ts` - CLI entrypoint (shebang: `#!/usr/bin/env bun`)
- `src/config.ts` - Configuration loading
- `src/logger.ts` - Dual-output logging (stderr + file)
- `src/errors.ts` - Error types
- `src/index.ts` - Public API exports
- `tests/config.test.ts` - Config tests
- `package.json` - Registered as `ralphly` with bin entry
- `tsconfig.json` - TypeScript config

### 2. Ralphly has a CLI entrypoint for manual execution
**PASS** - `cli.ts` uses `@effect/cli` with two subcommands:
- `run [--dry-run]` — Main execution command
- `config` — Display current configuration

CLI help output confirmed working:
```
$ ralphly --help
ralphly 0.0.1
COMMANDS
  - run [--dry-run]
  - config
```

### 3. Ralphly can load its required configuration
**PASS** - Config loads from env vars and `.ralphly/config.json`:
- `RALPHLY_REPO_PATH` / `repoPath`
- `LINEAR_API_KEY` / `linear.apiKey`
- `LINEAR_AGENT_ID` / `linear.agentId`
- Defaults: `maxAttempts=2`, `checks=[]`

Verified with env vars:
```
$ RALPHLY_REPO_PATH=/tmp/test LINEAR_API_KEY=key LINEAR_AGENT_ID=agent ralphly config
Current configuration:
  Repo path:    /tmp/test
  Agent ID:     agent
  API key:      key...
  Max attempts: 2
  Checks:       (none)
```

Config validation works — missing fields produce clear error messages with env var hints.

### 4. CLI-first, no HTTP or webhook infrastructure
**PASS** - Grep for http/webhook/server/express/fastify/hono found only a comment explicitly stating "no HTTP server or webhook receiver". No HTTP dependencies in package.json.

### 5. Skeleton ready for later integration
**PASS** - The app imports `@workspace/blueprints` as a dependency. The `run` command has TODO placeholders for Linear query, blueprint processing, and progress writing. The Effect-based architecture makes it straightforward to compose additional layers.

## Functional Testing

| Test | Result |
|------|--------|
| `ralphly --help` | PASS - Shows commands and options |
| `ralphly config` (no env) | PASS - Lists missing required fields |
| `ralphly config` (with env) | PASS - Displays resolved config |
| `ralphly run --dry-run` (with env) | PASS - Loads config and exits cleanly |
| `ralphly run` (no config) | PASS - Fails with FatalError listing missing fields |
| `bun test tests/` | PASS - 7 tests, 0 failures, 23 assertions |
| `tsc --noEmit` | PASS - No type errors |

## Non-goals Confirmed
- No worker loop implemented (placeholder only)
- No worktree logic
- No webhook handling
- App is minimal and focused on CLI shell + config
