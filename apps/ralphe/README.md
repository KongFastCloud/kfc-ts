# ralphe

Effect TS AI coding agent task runner. Runs AI agents (Claude Code, Codex) against tasks, verifies output with shell commands, and retries with error feedback on failure.

## Install

```bash
cd apps/ralphe && bun run link
```

This registers the `ralphe` CLI globally via symlink.

## Usage

```bash
# Text task
ralphe run "fix the failing tests"

# File task (e.g. a PRD)
ralphe run --file PRD.md
ralphe run -f tasks.txt

# Override engine
ralphe run --engine codex "add input validation"
```

## Config

Run `ralphe config` to interactively configure per-project settings. This creates `.ralphe/config.json` in the current directory.

```bash
ralphe config
```

The wizard auto-detects your project type (Node/Python/Go/Rust) and suggests check commands.

```json
{
  "engine": "claude",
  "maxAttempts": 2,
  "checks": [
    "bun run typecheck",
    "bun run lint",
    "bun test"
  ],
  "autoCommit": false
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `engine` | `"claude"` | AI engine (`"claude"` or `"codex"`) |
| `maxAttempts` | `2` | Max retry attempts on check failure |
| `checks` | `[]` | Shell commands to verify agent output |
| `autoCommit` | `false` | Auto-commit and push on success |

Without a config, ralphe runs the agent with no checks.

## How It Works

```
1. Agent receives task (text or file contents)
2. Agent makes changes
3. Check commands run (typecheck, lint, test)
4. If checks fail → retry with error feedback (clean context)
5. If checks pass → optionally commit + push
```

When `autoCommit` is enabled, ralphe uses the engine to generate a conventional commit message from the staged diff, then commits and pushes.

## Engines

- **Claude Code** (default) — uses `@anthropic-ai/claude-agent-sdk`
- **Codex** — uses `codex exec --full-auto --json` CLI

## Errors

- `CheckFailure` — retryable (check command failed)
- `FatalError` — abort (CLI not found, auth error, max retries exceeded)
