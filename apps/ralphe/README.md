# ralphe

Effect TS AI coding agent task runner. Runs AI agents (Claude Code, Codex) against tasks, verifies output with shell commands (typecheck, lint, test), and retries with error feedback on failure.

## Usage

```bash
bun run cli.ts "fix the failing tests"
bun run cli.ts --engine codex "add input validation"
```

## Config

Create `.ralphe/config.ts` in your project root:

```ts
import { Effect, pipe } from "effect"
import { agent, cmd, loop } from "ralphe"

export default (task: string) =>
  loop(
    (feedback) =>
      pipe(
        agent(task, { feedback }),
        Effect.andThen(cmd("npm run typecheck")),
        Effect.andThen(cmd("npm run lint")),
        Effect.andThen(cmd("npm run test")),
      ),
    { maxAttempts: 2 },
  )
```

## API

### `agent(task, opts?)`

Sends a prompt to the configured AI engine. Appends previous error feedback on retries.

- Returns `Effect<AgentResult, CheckFailure | FatalError, Engine>`

### `cmd(command)`

Runs a shell command. Non-zero exit produces a `CheckFailure` (retryable).

- Returns `Effect<CmdResult, CheckFailure | FatalError>`

### `loop(fn, opts?)`

Retry combinator. Catches `CheckFailure`, feeds stderr as feedback to the next attempt. Converts to `FatalError` after `maxAttempts` (default: 2).

- Returns `Effect<void, FatalError, R>` — `CheckFailure` is eliminated from the error channel

## Engines

- **Claude Code** (default) — uses `@anthropic-ai/claude-agent-sdk`
- **Codex** — uses `codex exec --full-auto --json` CLI

## Errors

- `CheckFailure` — retryable (typecheck/lint/test failed)
- `FatalError` — abort (CLI not found, auth error, max retries exceeded)
