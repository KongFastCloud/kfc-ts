# ralphly

A Linear-aware CLI worker that drains delegated work items from Linear and processes them through AI blueprints (Claude Agent SDK). ralphly is CLI-first and manually invoked — there is no HTTP server or webhook receiver.

## Quick start

```
# 1. Configure
export RALPHLY_REPO_PATH=/absolute/path/to/your/repo
export LINEAR_API_KEY=lin_api_...
export LINEAR_AGENT_ID=your-agent-id

# 2. Verify configuration
ralphly config

# 3. Preview what would happen
ralphly run --dry-run

# 4. Run for real
ralphly run
```

## Commands

### `ralphly config`

Shows the resolved configuration with value sources. Reports whether configuration is complete or lists any missing required values.

```
─── Configuration ───

  Repo path:    /Users/you/your-repo
                (from env: RALPHLY_REPO_PATH)
  Agent ID:     abc123
                (from .ralphly/config.json)
  API key:      lin_api_...
                (from env: LINEAR_API_KEY)
  Max attempts: 2
  Checks:       (none)

Configuration is complete. Ready to run.
```

If any required values are missing, `config` will list them and tell you where to set them.

### `ralphly run --dry-run`

Connects to Linear, loads candidate work delegated to the configured agent, classifies each issue's readiness, and prints a structured summary — without processing anything.

Each candidate is classified as one of:

| Readiness     | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| **actionable** | Ready to process (Todo or In Progress, not blocked/held)  |
| **blocked**    | Has unresolved blocker relationships                      |
| **error-held** | Previous attempt failed; held until manually resolved     |
| **ineligible** | In a non-ready workflow state (Backlog, Triage, etc.)     |
| **terminal**   | Already completed, canceled, or marked duplicate          |

This is the recommended way to verify your setup is working before a real run.

### `ralphly run`

Drains the backlog sequentially — picks the next actionable issue, processes it through blueprints, records the outcome back to Linear, then repeats until no actionable work remains.

The exit summary includes a reason code:

| Exit reason        | Meaning                                          |
| ------------------ | ------------------------------------------------ |
| `no_candidates`    | Nothing delegated to this agent                  |
| `no_actionable`    | Candidates exist but none are actionable         |
| `backlog_drained`  | All actionable work was processed                |
| `iteration_limit`  | Safety bound reached (should not happen normally)|

## Configuration

ralphly requires three values to run. You can provide them via environment variables, a config file, or a mix of both.

### Required values

| Value       | Env var              | Config file path      | Description                              |
| ----------- | -------------------- | --------------------- | ---------------------------------------- |
| Repo path   | `RALPHLY_REPO_PATH`  | `repoPath`            | Absolute path to the repository workspace |
| API key     | `LINEAR_API_KEY`     | `linear.apiKey`       | Linear API key for SDK authentication     |
| Agent ID    | `LINEAR_AGENT_ID`    | `linear.agentId`      | Linear agent ID that ralphly operates as  |

### Optional values

| Value        | Config file path | Default | Description                                |
| ------------ | ---------------- | ------- | ------------------------------------------ |
| Max attempts | `maxAttempts`    | `2`     | Maximum retry attempts per issue            |
| Checks       | `checks`         | `[]`    | Check commands to run after agent execution |

### Environment variables

Export the required variables in your shell or add them to your shell profile:

```sh
export RALPHLY_REPO_PATH=/absolute/path/to/your/repo
export LINEAR_API_KEY=lin_api_...
export LINEAR_AGENT_ID=your-agent-id
```

### Config file

Alternatively (or in addition), create `.ralphly/config.json` in the workspace root:

```json
{
  "repoPath": "/absolute/path/to/your/repo",
  "linear": {
    "apiKey": "lin_api_...",
    "agentId": "your-agent-id"
  },
  "maxAttempts": 2,
  "checks": []
}
```

### Precedence

When a value is set in both places, **environment variables win**. The full resolution order is:

1. **Environment variables** (highest priority)
2. **Config file** (`.ralphly/config.json`)
3. **Defaults** (for `maxAttempts` and `checks` only)

Run `ralphly config` to see exactly where each resolved value is coming from.

## Verifying your setup

The recommended verification flow:

```sh
# Step 1: Check that all required values are resolved
ralphly config

# Step 2: Confirm Linear connectivity and see your backlog
ralphly run --dry-run
```

Both commands are read-only and safe to repeat. If `config` shows "Configuration is complete. Ready to run." and `run --dry-run` connects successfully, your setup is correct.

## Local development

```sh
# Install dependencies (from monorepo root)
bun install

# Run the CLI locally
bun run dev config
bun run dev run --dry-run

# Run tests
bun test

# Type-check
bun run typecheck

# Link the CLI globally so `ralphly` is available on your PATH
bun link
```

## Logs

ralphly writes logs to two destinations:

- **stderr**: logfmt format for console output
- **File**: daily JSON logs at `.ralphly/logs/ralphly-YYYY-MM-DD.log`
