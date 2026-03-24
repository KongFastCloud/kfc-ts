# @workspace/blueprints

Primitives-first execution toolkit for agent-driven tasks. Blueprints provides reusable execution steps, a retry loop, and low-level combinators. Apps (ralphe, ralphly) compose their own workflows from these building blocks.

Blueprints does not own orchestration policy, step ordering, or lifecycle side effects. Those concerns live in the consuming app.

## Package ownership

### Blueprints owns

- **Engine interface** — abstract `Engine` type and `AgentResult` for pluggable agent backends
- **Retry loop** — `loop()` primitive with feedback propagation and lifecycle events
- **Execution steps** — `agent()`, `cmd()`, `report()` for individual pipeline stages
- **Git primitives** — `gitCommit()`, `gitPush()`, `gitWaitForCi()`, `isWorktreeDirty()`
- **Git composition helpers** — `buildCiGitStep()`, `executePostLoopGitOps()` for common git patterns
- **Error types** — `CheckFailure` (retryable) and `FatalError` (terminal)

### Apps own

- **Workflow assembly** — step ordering, pipeline composition, and result shaping
- **Lifecycle observers** — side effects on start, retry, success, failure (Beads comments, Linear activities, etc.)
- **Prompt construction** — building the task string from issue data, context, and previous errors
- **Tracker integration** — Linear, Beads, or any external system
- **Durable queueing and scheduling** — fan-out, polling, persistence
- **Tracing and telemetry** — blueprints is tracing-unaware

---

## Quick start: composing a workflow from primitives

```ts
import {
  Engine, loop, agent, cmd, report,
  buildCiGitStep, executePostLoopGitOps, defaultGitOps,
  type AgentResult, type LoopEvent, type GitMode,
} from "@workspace/blueprints"
import { Effect, Layer } from "effect"

// 1. Provide an Engine implementation
const myEngine: Engine = {
  execute: (prompt, workDir) =>
    Effect.succeed({ response: "Done.", resumeToken: "sess-abc" }),
}
const engineLayer = Layer.succeed(Engine, myEngine)

// 2. Assemble your workflow from primitives
const workspace = "/path/to/repo"
const gitMode: GitMode = "commit_and_push"
const checks = ["bun test", "bun run lint"]
const ops = defaultGitOps
let lastToken: string | undefined

const workflow = Effect.gen(function* () {
  // Retry loop with agent → checks → report
  yield* loop(
    (feedback, attempt, maxAttempts) => {
      let pipeline: Effect.Effect<unknown, any, Engine> =
        agent("Implement the login page", workspace, { feedback }).pipe(
          Effect.tap((r: AgentResult) => { lastToken = r.resumeToken; return Effect.void }),
        )

      for (const check of checks) {
        pipeline = pipeline.pipe(Effect.andThen(cmd(check, workspace)))
      }

      // Optional: add report step
      // pipeline = pipeline.pipe(Effect.andThen(report(task, workspace, "basic")))

      // Optional: add in-loop CI step
      // if (gitMode === "commit_and_push_and_wait_ci") {
      //   pipeline = pipeline.pipe(Effect.andThen(buildCiGitStep(ops, workspace)))
      // }

      return pipeline
    },
    {
      maxAttempts: 3,
      onEvent: (event: LoopEvent) => {
        // Your lifecycle side effects here (post comments, update tracker, etc.)
        return Effect.void
      },
    },
  )

  // Post-loop git operations
  yield* executePostLoopGitOps(gitMode, ops, workspace)
})

// 3. Run with error handling
const result = await Effect.runPromise(
  workflow.pipe(
    Effect.provide(engineLayer),
    Effect.catchTag("FatalError", (err) => Effect.succeed({ error: err.message })),
  ),
)
```

---

## Primitives reference

### Engine interface

Callers must provide an `Engine` implementation via Effect's context system:

```ts
interface Engine {
  execute(prompt: string, workDir: string): Effect<AgentResult, CheckFailure | FatalError>
}

interface AgentResult {
  response: string
  resumeToken?: string   // Session ID for resumable conversations
}
```

Provide it as a Layer:

```ts
import { Engine } from "@workspace/blueprints"
import { Layer } from "effect"

const engineLayer = Layer.succeed(Engine, {
  execute: (prompt, workDir) => myAgentCall(prompt, workDir),
})
```

### Error types

| Error | Retryable | When raised | Example |
|---|---|---|---|
| `CheckFailure` | Yes | A check command exits non-zero, verification report fails, or CI fails | `bun test` exits 1 |
| `FatalError` | No | Unrecoverable failure (spawn error, auth failure, max attempts exhausted) | Cannot spawn shell process |

`CheckFailure` carries `command`, `stderr`, and `exitCode`. `FatalError` carries `command` and `message`.

### `loop(fn, opts?): Effect<void, FatalError, R>`

Generic retry loop with feedback propagation. On `CheckFailure`, captures stderr as feedback and passes it to the next attempt. After max attempts, escalates to `FatalError`.

```ts
loop(
  (feedback, attempt, maxAttempts) => {
    // Your Effect-based pipeline. Raise CheckFailure to retry, FatalError to abort.
  },
  { maxAttempts: 3, onEvent: (e) => Effect.void },
)
```

Default `maxAttempts` is `2`.

#### Loop events

```ts
interface LoopEvent {
  type: "attempt_start" | "check_failed" | "success"
  attempt: number      // 1-indexed
  maxAttempts: number
  feedback?: string    // Present on check_failed and on retried attempt_start
}
```

### `agent(task, workspace, opts?): Effect<AgentResult, CheckFailure | FatalError, Engine>`

Executes the task prompt via the `Engine`. If `opts.feedback` is provided, appends it as `"\n\nPrevious attempt failed:\n<feedback>"`.

### `cmd(command, workspace): Effect<CmdResult, CheckFailure | FatalError>`

Runs a shell command via `sh -c` in the given workspace. Returns `CmdResult` on exit 0. Raises `CheckFailure` on non-zero exit, `FatalError` on spawn failure.

### `report(task, workspace, mode, opts?): Effect<ReportResult, CheckFailure | FatalError, Engine>`

Runs a verification agent that checks the implementation. A failing verification raises `CheckFailure` (retryable). Modes: `"browser"` or `"basic"`. Reports are saved to `.blueprints/reports/` by default.

### Git primitives

| Function | Signature | Description |
|---|---|---|
| `gitCommit(workspace)` | `Effect<GitCommitResult \| undefined, FatalError, Engine>` | Stage all changes, generate commit message via engine, commit. Returns `undefined` if no changes. |
| `gitPush(workspace)` | `Effect<GitPushResult, FatalError>` | Push to configured remote. |
| `gitWaitForCi(workspace)` | `Effect<GitHubCiResult, FatalError \| CheckFailure>` | Poll GitHub Actions until completion. CI failure raises `CheckFailure` with structured annotations. |
| `isWorktreeDirty(workspace)` | `Effect<boolean, FatalError>` | Check for uncommitted changes. |

### Git composition helpers

These combine git primitives into common patterns. Apps use them as building blocks in their workflows.

#### `buildCiGitStep(ops, workspace): Effect<void, FatalError | CheckFailure, Engine>`

Commits, pushes, and waits for CI. Use inside a loop body when git mode is `"commit_and_push_and_wait_ci"`. CI failure raises `CheckFailure` so the loop can retry with structured annotations.

#### `executePostLoopGitOps(gitMode, ops, workspace): Effect<void, FatalError, Engine>`

Handles post-loop git operations for `"commit"` and `"commit_and_push"` modes. No-op for `"none"` and `"commit_and_push_and_wait_ci"` (which runs inside the loop).

#### `defaultGitOps: GitOps`

Default `GitOps` implementation using the real git primitives. Pass this to `buildCiGitStep` and `executePostLoopGitOps`, or provide a test double.

---

## Workspace contract

Blueprints enforces an **explicit workspace contract**: every primitive that interacts with the filesystem accepts a `workspace` parameter, and no primitive falls back to `process.cwd()`.

### The contract

```
Caller selects or prepares a workspace directory.
Blueprints primitives execute exclusively inside that workspace.
```

This is a hard invariant, not a convention. The workspace parameter is required (not optional) on every execution surface: `agent()`, `cmd()`, `report()`, `gitCommit()`, `gitPush()`, `gitWaitForCi()`, `isWorktreeDirty()`, `buildCiGitStep()`, and `executePostLoopGitOps()`.

### Why not process.cwd()?

When execution defaults to `process.cwd()`, the runner can silently operate in the wrong directory — a real bug when the CLI is launched from a different location than the target workspace. The explicit workspace contract eliminates this class of bug entirely.

### What "workspace" means

The workspace is the single directory where:

- The agent executes tasks
- Shell check commands run (`cmd()`)
- Verification reports are written (`report()`)
- Git operations apply (`gitCommit()`, `gitPush()`, etc.)

It is the execution root for the entire pipeline. When an app composes primitives into a workflow, the same workspace is threaded through every step.

### Workspace is opaque

Blueprints treats the workspace path as an opaque string. It does not assume the path is:

- The repository root
- The caller's current directory
- A fixed location

This means the workspace can be:

- A repository root (the common case today)
- A subdirectory within a repository
- A git worktree directory (future)
- Any valid filesystem path

### Future worktree readiness

The workspace contract is shaped for future worktree support. The abstraction boundary is:

```
┌─────────────────────────────┐
│  Caller (ralphly, ralphe)   │  ← selects or prepares workspace
│  ┌───────────────────────┐  │
│  │  Worktree layer       │  │  ← (future) provisions temp worktree
│  │  (not yet implemented)│  │
│  └───────────────────────┘  │
│  workspace path ─────────────┼──→ blueprints primitives execute inside it
└─────────────────────────────┘
```

When worktree support is added:

1. A worktree preparation layer will create a temporary git worktree for the issue
2. It will pass the worktree path as the `workspace` parameter
3. Blueprints will execute inside it — no code changes to primitives needed
4. The caller will handle worktree cleanup after execution

No primitive needs to know whether the workspace is a worktree or a repo root. The contract remains: caller provides the path, blueprints executes inside it.

### Threading workspace through a workflow

Apps are responsible for threading the workspace through their composed workflows:

```ts
const workspace = config.workspacePath // from config or worktree prep

// Every primitive receives the same workspace
const pipeline = pipe(
  agent(task, workspace, { feedback }),
  Effect.andThen(cmd("bun test", workspace)),
  Effect.andThen(report(task, workspace, "basic")),
)

// Git operations also receive workspace
yield* executePostLoopGitOps(gitMode, ops, workspace)
```

### Test coverage

The workspace contract is tested at two levels:

1. **Primitives level** (`packages/blueprints/tests/workspace-cwd.test.ts`, `workspace-contract.test.ts`) — proves each primitive operates in the configured workspace and never falls back to `process.cwd()`.

2. **App level** (`apps/ralphly/tests/workspace-propagation.test.ts`) — proves the full flow from config loading through the runner to every primitive invocation.

