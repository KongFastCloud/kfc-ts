## Problem Statement

Ralphe uses `Console.log()` from Effect for all output — 54 call sites across 13 files. Every message has the same severity, no structured context, and output only exists in the terminal session. When an AI agent needs to debug a failed ralphe run (especially in watch mode), there is no log file to read back, no way to filter by task ID, and no way to distinguish progress noise from actionable warnings.

## Solution

Replace all `Console.log()` calls with Effect's structured logging (`Effect.logInfo`, `Effect.logDebug`, `Effect.logWarning`, `Effect.logError`). Use `Effect.annotateLogs` and `Effect.withLogSpan` to attach canonical context (task ID, worker ID, issue title) to every log line within a task's lifecycle. Log structured JSON lines to a file in `.ralphe/logs/` so agents can read and grep logs after the fact. Keep stderr output via Effect's default logger for live terminal visibility.

## User Stories

1. As an AI agent debugging a failed ralphe watch run, I want to read a structured log file so I can understand what happened without needing to have been watching the terminal.
2. As an AI agent investigating a specific task failure, I want to filter logs by task ID so I can isolate the relevant context.
3. As a developer reading ralphe source, I want log calls to communicate intent (info vs warning vs debug) rather than being uniformly `Console.log`.

## Implementation Decisions

### Dual logger setup

Wire two loggers at the program root in `cli.ts`:

1. **Stderr logger** — Effect's default `Logger.logfmt` for live terminal output. Human-readable, key-value format.
2. **File logger** — Custom `Logger.make` that appends JSON lines to `.ralphe/logs/ralphe-<date>.log`. One file per calendar day to provide natural rotation.

Both loggers are composed via `Logger.zip` and provided as a single layer alongside `BunContext.layer`.

### Canonical log annotations

Use `Effect.annotateLogs` at key scope boundaries to attach context that propagates to all log lines within that fiber:

- **Watch mode (`watcher.ts`)**: Annotate with `workerId` when the watcher starts. When picking up a task, annotate with `taskId` and `issueTitle`.
- **Run mode (`cli.ts` run command)**: Annotate with `engine` and `task` (truncated).
- **Task lifecycle (`runTask.ts`)**: Annotate with `gitMode`.
- **Loop (`loop.ts`)**: Annotate with `attempt` and `maxAttempts`.

Use `Effect.withLogSpan` around major operations (`task`, `agent`, `ci-wait`, `verification`) to get automatic duration tracking in log output.

### Log level mapping

| Level | When to use | Examples |
|-------|-------------|---------|
| `Effect.logDebug` | Polling status, retry delays, interim progress only useful when diagnosing a stuck run | "No CI run found yet, retrying in 10s...", "CI in progress, checking again in 10s...", "Worktree is clean — resuming automatic pickup", "Running: <command>" |
| `Effect.logInfo` | Key milestones and state transitions | "Running agent...", "Agent done.", "Committed.", "Pushed.", "CI succeeded", "Task completed successfully", "Claimed task: X" |
| `Effect.logWarning` | Recoverable problems that may need attention | "Check failed, will retry", "Verification failed", "Worktree has uncommitted changes — pausing", "Task exhausted all retries" |
| `Effect.logError` | Unrecoverable failures (future use — none exist today) | — |

### Modules to modify

**New module:**
- `src/logger.ts` — File logger implementation, dual logger layer factory, log directory setup.

**Modified modules (Console.log → Effect.log\*):**
- `cli.ts` — Wire logger layer, add top-level annotations, convert ~12 log calls.
- `src/agent.ts` — 2 calls
- `src/beads.ts` — 1 call
- `src/beadsAdapter.ts` — 1 call
- `src/cmd.ts` — 2 calls
- `src/engine/ClaudeEngine.ts` — 1 call
- `src/engine/CodexEngine.ts` — 1 call
- `src/git.ts` — 10 calls
- `src/loop.ts` — 3 calls, add `attempt`/`maxAttempts` annotations
- `src/report.ts` — 4 calls
- `src/runTask.ts` — 9 calls, add `gitMode` annotation
- `src/watcher.ts` — 11 calls, add `workerId`/`taskId`/`issueTitle` annotations, add `task` log span
- `src/watchTui.tsx` — 3 calls

### Log audit — not a blind migration

Do NOT mechanically convert all 54 `Console.log` calls. Each call site must be evaluated:

- **Keep and convert** — if the message provides useful signal for an agent debugging a failure or understanding what happened during a run.
- **Remove** — if the message is redundant (information already captured by annotations or spans), purely cosmetic ("Done!"), or restates what the next log line will say anyway.
- **Add new logs** — where visibility gaps exist. In particular, look for:
  - Error paths that currently swallow failures silently
  - State transitions with no log (e.g., entering/exiting retry logic, config loading decisions)
  - Decision points where the code picks one branch over another (e.g., "Push skipped: no commit created" is good — but are there similar decisions without logs?)

The goal is a log stream that lets an agent reconstruct what happened and why, not a line-by-line translation of the current output.

### Migration pattern (for retained log sites)

Each retained call site changes from:

```typescript
yield* Console.log(`message`)
```

to one of:

```typescript
yield* Effect.logInfo(`message`)
yield* Effect.logDebug(`message`)
yield* Effect.logWarning(`message`)
```

Remove `Console` imports where they become unused.

Canonical context is added at scope boundaries, not at each log call:

```typescript
const processTask = (issue: Issue) =>
  pipe(
    runTaskWorkflow(issue),
    Effect.annotateLogs({ taskId: issue.id, issueTitle: issue.title }),
    Effect.withLogSpan("task")
  )
```

### Log file format

JSON lines, one object per log entry:

```json
{"timestamp":"2026-03-20T10:30:00.000Z","level":"INFO","message":"Running agent...","taskId":"ISSUE-42","issueTitle":"Fix the bug","workerId":"w1","spans":{"task":"0ms"}}
{"timestamp":"2026-03-20T10:31:05.000Z","level":"INFO","message":"Agent done.","taskId":"ISSUE-42","issueTitle":"Fix the bug","workerId":"w1","spans":{"task":"65000ms"}}
```

### Log file location

`.ralphe/logs/ralphe-YYYY-MM-DD.log` — relative to the project root. The `.ralphe/` directory already exists for config. Add `logs/` to `.gitignore` if not already ignored.

## Testing Decisions

- No new unit tests. This is a mechanical refactor — message strings stay the same, just routed through Effect's logger.
- Verify by running `bun run build` (type-check) and manually confirming:
  - Stderr output still appears in terminal.
  - A log file is created in `.ralphe/logs/` with valid JSON lines.
  - Annotations (taskId, etc.) appear in log output.

## Out of Scope

- No `--verbose` / `--quiet` flags or runtime log level configuration.
- No log shipping or external log aggregation.
- No changes to `apps/kongfastchat/`.
- No changes to error handling or control flow.
- No log cleanup/retention policy beyond daily file rotation.

## Further Notes

- Effect's `Console.log` writes to stdout. `Effect.log*` routes through the Logger service, which by default writes to stderr. This is actually more correct for a CLI — stdout stays clean for piped output.
- The `FiberRef` system means annotations propagate to child fibers automatically — no need to manually thread context through function arguments.
- Daily log files provide natural rotation. For watch mode runs that span midnight, logs will split across files, but this is acceptable since agents can glob `.ralphe/logs/ralphe-*.log`.
