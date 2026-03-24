# @workspace/blueprints

Shared execution runner for agent-driven tasks. Blueprints composes an agent step, validation checks, an optional verification report, and git operations into a retry loop with lifecycle events. Callers prepare task input, provide an `Engine` implementation, and receive a structured `RunResult`.

Blueprints is deliberately agnostic to trackers (Linear, Beads, etc.), prompt assembly policy, and durable queueing. Those concerns live in the caller.

## What blueprints owns

- The retry loop with feedback propagation
- Lifecycle event emission (`attempt_start`, `check_failed`, `success`)
- Pipeline orchestration: agent → checks → report → git
- Result shaping into `RunResult`
- Error classification (`CheckFailure` vs `FatalError`)

## What blueprints does not own

- **Tracker state.** Updating issue status, posting comments, or reading tracker metadata is the caller's job. Use the `onEvent` and `onAgentResult` callbacks to bridge into your tracker.
- **Prompt assembly policy.** The caller decides how to build the task string. Blueprints receives a fully-formed `task: string` and appends failure feedback on retries — nothing else.
- **Durable queueing.** Blueprints executes a single run synchronously. Scheduling, fan-out, and persistence are caller concerns.
- **Engine implementation.** Blueprints defines the `Engine` interface but never instantiates a concrete engine. The caller provides one via an Effect `Layer`.

---

## Quick start

```ts
import { run, Engine, type RunConfig, type RunnerOptions } from "@workspace/blueprints"
import { Effect, Layer } from "effect"

// 1. Implement the Engine interface
const myEngine: Engine = {
  execute: (prompt, workDir) =>
    Effect.succeed({ response: "Done.", resumeToken: "sess-abc" }),
}

// 2. Configure the run
const config: RunConfig = {
  maxAttempts: 3,
  checks: ["bun test", "bun run lint"],
  gitMode: "commit_and_push",
  report: "none",
}

// 3. Execute
const result = await Effect.runPromise(
  run({
    task: "Implement the login page",
    config,
    engineLayer: Layer.succeed(Engine, myEngine),
  }),
)

console.log(result)
// { success: true, resumeToken: "sess-abc", attempts: 1 }
```

---

## API reference

### `run(opts: RunnerOptions): Effect<RunResult, never>`

The primary entry point. Orchestrates the full pipeline and **never fails** — errors are captured in `RunResult.error`.

#### `RunnerOptions`

| Field | Type | Required | Description |
|---|---|---|---|
| `task` | `string` | yes | Fully-formed task prompt. The caller is responsible for assembling this, including any context from trackers or previous runs. |
| `config` | `RunConfig` | yes | Retry count, check commands, git mode, and report mode. |
| `engineLayer` | `Layer<Engine>` | yes | Effect Layer providing the concrete `Engine` implementation. |
| `onEvent` | `(event: LoopEvent) => Effect<void>` | no | Lifecycle event callback. Fires on `attempt_start`, `check_failed`, and `success`. |
| `onAgentResult` | `(result: AgentResult, attempt: number, maxAttempts: number) => Effect<void>` | no | Fires after each successful agent execution. Use this to capture the `resumeToken` or post incremental updates. |
| `gitOps` | `GitOps` | no | Override git operations for testing. |

#### `RunConfig`

| Field | Type | Description |
|---|---|---|
| `maxAttempts` | `number` | Maximum number of attempts before the run fails. |
| `checks` | `string[]` | Shell commands to run as validation after each agent attempt. Empty array means no checks. |
| `gitMode` | `GitMode` | Git behavior after task completion. See [Git modes](#git-modes). |
| `report` | `"browser" \| "basic" \| "none"` | Whether to run a verification agent after checks pass. |

#### `RunResult`

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | Whether the run completed without error. |
| `resumeToken` | `string \| undefined` | Session/thread ID from the last agent execution. Preserved across retries. |
| `error` | `string \| undefined` | Error message if `success` is `false`. |
| `attempts` | `number` | Total attempts made. `1` means the first attempt succeeded. |

---

### Retry model

Blueprints uses a **ralphe-style retry loop**: the caller provides a task string, and on failure the loop appends structured feedback and re-invokes the agent with the augmented prompt.

#### How it works

1. The loop calls the pipeline function with `feedback = undefined` on the first attempt.
2. If any step raises `CheckFailure`, the loop captures the failure details as a feedback string and increments the attempt counter.
3. On the next attempt, the feedback is appended to the task prompt:
   ```
   <original task>

   Previous attempt failed:
   Command "<command>" failed (exit <code>):
   <stderr>
   ```
4. If the final attempt fails, `CheckFailure` is escalated to `FatalError` and the run terminates.

#### Error classification

| Error | Retryable | When raised | Example |
|---|---|---|---|
| `CheckFailure` | Yes | A check command exits non-zero, verification report fails, or CI fails | `bun test` exits 1 |
| `FatalError` | No | Unrecoverable failure (spawn error, auth failure, max attempts exhausted) | Cannot spawn shell process |

`CheckFailure` carries `command`, `stderr`, and `exitCode`. `FatalError` carries `command` and `message`.

---

### Lifecycle events

The `onEvent` callback receives a `LoopEvent` at each stage of the retry loop:

```ts
interface LoopEvent {
  type: "attempt_start" | "check_failed" | "success"
  attempt: number      // Current attempt (1-indexed)
  maxAttempts: number
  feedback?: string    // Present on check_failed and on attempt_start for retries
}
```

#### Event sequence

**First-attempt success:**
```
attempt_start (attempt=1) → success (attempt=1)
```

**Failure then success:**
```
attempt_start (attempt=1) → check_failed (attempt=1, feedback="...") → attempt_start (attempt=2) → success (attempt=2)
```

**All attempts exhausted:**
```
attempt_start (attempt=1) → check_failed (attempt=1, feedback="...") → attempt_start (attempt=2) → FatalError
```

Note: `check_failed` is **not** emitted on the final attempt. When the last attempt fails, the error escalates directly to `FatalError`.

---

### Pipeline steps

The `run()` function composes these steps sequentially. Each is also exported individually for callers that need lower-level composition.

#### `agent(task, opts?): Effect<AgentResult, CheckFailure | FatalError, Engine>`

Executes the task prompt via the `Engine`. If `opts.feedback` is provided, it is appended to the prompt as `"\n\nPrevious attempt failed:\n<feedback>"`.

#### `cmd(command): Effect<CmdResult, CheckFailure | FatalError>`

Runs a shell command via `sh -c`. Returns `CmdResult` (`{ stdout, stderr, exitCode }`) on exit 0. Raises `CheckFailure` on non-zero exit, `FatalError` if the process cannot be spawned.

#### `report(task, mode, opts?): Effect<ReportResult, CheckFailure | FatalError, Engine>`

Runs a verification agent that checks the implementation and returns a structured `ReportResult`. A failing verification raises `CheckFailure` (retryable). Modes:
- `"browser"` — instructs the agent to use browser-based verification for web UIs.
- `"basic"` — terminal-only verification.

Reports are saved to `.blueprints/reports/` by default (configurable via `opts.reportsDir`).

---

### Git modes

Git operations run **after** the retry loop succeeds (except CI mode, which runs inside the loop).

| Mode | Behavior |
|---|---|
| `"none"` | No git operations. |
| `"commit"` | Stage all changes and commit with an agent-generated message. |
| `"commit_and_push"` | Commit and push to the remote. |
| `"commit_and_push_and_wait_ci"` | Commit, push, and wait for GitHub Actions CI. CI failure raises `CheckFailure` with structured annotations, triggering a retry of the entire pipeline. |

The `commit_and_push_and_wait_ci` mode is the only mode that participates in the retry loop. All other modes run as a post-loop step and raise `FatalError` on failure (no retry).

---

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

---

### `loop(fn, opts?): Effect<void, FatalError, R>`

The generic retry loop primitive. Used internally by `run()` but exported for callers who need custom pipeline composition without the full runner.

```ts
const result = loop(
  (feedback, attempt, maxAttempts) => {
    // Your Effect-based pipeline here.
    // Raise CheckFailure to trigger retry with feedback.
    // Raise FatalError to terminate immediately.
  },
  { maxAttempts: 3, onEvent: (e) => Effect.void },
)
```

Default `maxAttempts` is `2`.

---

## Caller responsibilities

1. **Prepare the task string.** Include all context the agent needs — issue description, acceptance criteria, relevant file paths, etc. Blueprints will only append failure feedback; it will not enrich the prompt.

2. **Provide an Engine.** Wrap your agent SDK (Claude, Codex, etc.) in the `Engine` interface and pass it as a Layer.

3. **Configure checks.** Decide which shell commands validate a successful attempt. These run in order after each agent execution.

4. **Handle lifecycle events.** Use `onEvent` to update tracker status, post comments, or log to external systems. Use `onAgentResult` to capture resume tokens or session metadata.

5. **Own the outer scheduling loop.** If you need to poll for new tasks, fan out across repos, or retry at the job level, that logic lives outside blueprints.
