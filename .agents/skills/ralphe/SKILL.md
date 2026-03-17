---
name: ralphe
description: Use this skill when the user wants to use, configure, debug, extend, or document the `ralphe` CLI in this repository. Covers the Bun/Effect task runner in `apps/ralphe`, including `ralphe run`, `ralphe config`, engine selection, retry/check/report flow, tests, and README/docs updates.
---

# Ralphe CLI

Use this skill for work on the local `ralphe` CLI at `apps/ralphe`.

## What Ralphe Is

`ralphe` is a Bun + Effect CLI that:

- accepts a task as text or from `--file`
- runs an AI coding engine (`claude` or `codex`)
- runs configured shell checks
- retries with failure feedback up to `maxAttempts`
- optionally runs a verification report step
- optionally stages, commits, and pushes changes

Primary files:

- `apps/ralphe/cli.ts`
- `apps/ralphe/src/agent.ts`
- `apps/ralphe/src/loop.ts`
- `apps/ralphe/src/cmd.ts`
- `apps/ralphe/src/report.ts`
- `apps/ralphe/src/git.ts`
- `apps/ralphe/src/engine/`
- `apps/ralphe/tests/`
- `apps/ralphe/README.md`

Important repo note:

- `apps/ralphe/ralphy` and `apps/ralphe/roast` are embedded upstream repos. They are not part of the active Bun CLI runtime unless the task explicitly targets them.

## When To Use This Skill

Use this skill when the user asks to:

- add or change `ralphe` CLI behavior
- update `ralphe` docs or examples
- debug `ralphe run` / `ralphe config`
- adjust retry, check, report, or auto-commit logic
- change Claude or Codex engine integration
- run or fix the `apps/ralphe` test suite

Do not use this skill for work on the separate `ralphy` or `roast` projects unless the user explicitly names those directories.

## Default Workflow

1. Read `apps/ralphe/README.md` and the relevant source files in `apps/ralphe/src/`.
2. Confirm the entrypoint and control flow in `apps/ralphe/cli.ts`.
3. Make the smallest change that fits the current design.
4. Validate with `bun test tests/` from `apps/ralphe`.
5. If behavior changed, update `apps/ralphe/README.md`.

## Commands

Run these from `apps/ralphe` unless the task requires otherwise.

Install and link:

```bash
bun install
bun run link
```

Run the CLI:

```bash
bun run cli.ts run "fix the failing tests"
bun run cli.ts run --file PRD.md
bun run cli.ts config
```

Test:

```bash
bun test tests/
```

Useful code search:

```bash
rg -n "config|report|autoCommit|engine|CheckFailure|FatalError" apps/ralphe
```

## Behavior Map

- `cli.ts`: defines `config` and `run`
- `config.ts`: loads and saves `.ralphe/config.json`
- `detect.ts`: suggests checks based on project type
- `agent.ts`: builds the prompt and calls the selected engine
- `cmd.ts`: runs shell checks with `Bun.spawn`
- `loop.ts`: retry loop, converts check failure into feedback
- `report.ts`: second-pass verification with structured JSON output
- `git.ts`: stages all changes, asks engine for commit message, commits, pushes

## Constraints And Cautions

- Prefer Bun commands over Node/npm equivalents in this app.
- Keep changes localized; this CLI is intentionally small.
- Treat `CheckFailure` as retryable and `FatalError` as terminal unless changing that contract on purpose.
- `report.ts` expects the verification agent to return exactly one fenced JSON block.
- `git.ts` stages all changes with `git add -A`; changes here can be high impact.
- If changing user-visible behavior, update `apps/ralphe/README.md`.
- If changing runtime semantics, add or update tests in `apps/ralphe/tests/`.

## Fast Paths

For a docs-only task:

1. Read `apps/ralphe/README.md`.
2. Update the smallest relevant section.
3. Skip tests unless docs describe changed behavior and you need to verify implementation first.

For a CLI behavior change:

1. Read `apps/ralphe/cli.ts` and the touched module in `apps/ralphe/src/`.
2. Edit the implementation.
3. Run `bun test tests/`.
4. Update `apps/ralphe/README.md` if flags, prompts, config, or flow changed.

For engine issues:

1. Inspect `apps/ralphe/src/engine/ClaudeEngine.ts` and `apps/ralphe/src/engine/CodexEngine.ts`.
2. Preserve the shared `Engine` interface.
3. Validate error handling and any parsed output shape.
