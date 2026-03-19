import fs from "node:fs"
import path from "node:path"

/**
 * Canonical git operation mode.
 * - "none": No automatic git operations after task completion
 * - "commit": Stage and commit changes but do not push
 * - "commit_and_push": Stage, commit, and push changes
 * - "commit_and_push_and_wait_ci": Stage, commit, push, and wait for CI
 */
export type GitMode =
  | "none"
  | "commit"
  | "commit_and_push"
  | "commit_and_push_and_wait_ci"

/** Valid GitMode values for runtime validation */
const VALID_GIT_MODES: readonly string[] = [
  "none",
  "commit",
  "commit_and_push",
  "commit_and_push_and_wait_ci",
]

export interface GitConfig {
  readonly mode: GitMode
}

export interface RalpheConfig {
  readonly engine: "claude" | "codex"
  readonly maxAttempts: number
  readonly checks: string[]
  readonly git: GitConfig
  readonly report: "browser" | "basic" | "none"
}

const CONFIG_DIR = ".ralphe"
const CONFIG_FILE = "config.json"

const DEFAULTS: RalpheConfig = {
  engine: "claude",
  maxAttempts: 2,
  checks: [],
  git: { mode: "none" },
  report: "none",
}

/**
 * Validate and return a GitMode value, or throw with a clear error.
 */
export function parseGitMode(value: unknown): GitMode {
  if (typeof value === "string" && VALID_GIT_MODES.includes(value)) {
    return value as GitMode
  }
  throw new Error(
    `Invalid git.mode value: ${JSON.stringify(value)}. Must be one of: ${VALID_GIT_MODES.join(", ")}`,
  )
}

/**
 * Resolve the canonical GitMode from a raw config object.
 * Uses only git.mode; defaults to "none" when missing.
 */
function resolveGitMode(raw: Record<string, unknown>): GitMode {
  const gitObj = raw.git
  if (gitObj && typeof gitObj === "object" && gitObj !== null && "mode" in gitObj) {
    return parseGitMode((gitObj as Record<string, unknown>).mode)
  }
  return DEFAULTS.git.mode
}

export const getConfigPath = (workDir = process.cwd()): string =>
  path.join(workDir, CONFIG_DIR, CONFIG_FILE)

export const loadConfig = (workDir = process.cwd()): RalpheConfig => {
  const configPath = getConfigPath(workDir)

  if (!fs.existsSync(configPath)) {
    return DEFAULTS
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const gitMode = resolveGitMode(raw)
    return {
      engine: raw.engine ?? DEFAULTS.engine,
      maxAttempts: raw.maxAttempts ?? DEFAULTS.maxAttempts,
      checks: Array.isArray(raw.checks) ? raw.checks : DEFAULTS.checks,
      git: { mode: gitMode },
      report: raw.report ?? DEFAULTS.report,
    }
  } catch {
    return DEFAULTS
  }
}

export const saveConfig = (config: RalpheConfig, workDir = process.cwd()): void => {
  const configDir = path.join(workDir, CONFIG_DIR)
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(
    path.join(configDir, CONFIG_FILE),
    JSON.stringify(config, null, 2) + "\n",
  )
}
