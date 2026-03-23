/**
 * ABOUTME: Configuration loading for ralphly.
 * Loads agent identity, Linear credentials, repository path, and execution
 * settings from a local config file and/or environment variables.
 * Config file lives at .ralphly/config.json in the workspace root.
 * Environment variables override config file values.
 */

import fs from "node:fs"
import path from "node:path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Linear API credentials and agent identity. */
export interface LinearIdentity {
  /** Linear API key for authenticating SDK calls. */
  readonly apiKey: string
  /** The Linear agent ID that ralphly operates as. */
  readonly agentId: string
}

/** Top-level ralphly configuration. */
export interface RalphlyConfig {
  /** Absolute path to the repository workspace ralphly operates in. */
  readonly repoPath: string
  /** Linear API credentials and agent identity. */
  readonly linear: LinearIdentity
  /** Maximum retry attempts per issue (passed to blueprints). */
  readonly maxAttempts: number
  /** Check commands to run after agent execution. */
  readonly checks: readonly string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_DIR = ".ralphly"
const CONFIG_FILE = "config.json"

const DEFAULTS = {
  maxAttempts: 2,
  checks: [] as readonly string[],
} as const

// ---------------------------------------------------------------------------
// Config file I/O
// ---------------------------------------------------------------------------

export const getConfigPath = (workDir = process.cwd()): string =>
  path.join(workDir, CONFIG_DIR, CONFIG_FILE)

interface RawConfigFile {
  repoPath?: string
  linear?: {
    apiKey?: string
    agentId?: string
  }
  maxAttempts?: number
  checks?: string[]
}

const readConfigFile = (workDir: string): RawConfigFile => {
  const configPath = getConfigPath(workDir)
  if (!fs.existsSync(configPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as RawConfigFile
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Environment variable resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a config value with environment variable override.
 * Env vars take precedence over config file values.
 */
const envOr = (envKey: string, fileValue: string | undefined): string | undefined =>
  process.env[envKey] || fileValue || undefined

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConfigError {
  readonly missing: string[]
}

/**
 * Load ralphly configuration from config file + environment.
 *
 * Resolution order (highest priority first):
 * 1. Environment variables: RALPHLY_REPO_PATH, LINEAR_API_KEY, LINEAR_AGENT_ID
 * 2. Config file values from .ralphly/config.json
 * 3. Defaults (for maxAttempts, checks)
 *
 * Returns either a valid config or an error listing missing required fields.
 */
export const loadConfig = (
  workDir = process.cwd(),
): { ok: true; config: RalphlyConfig } | { ok: false; error: ConfigError } => {
  const raw = readConfigFile(workDir)

  const repoPath = envOr("RALPHLY_REPO_PATH", raw.repoPath)
  const apiKey = envOr("LINEAR_API_KEY", raw.linear?.apiKey)
  const agentId = envOr("LINEAR_AGENT_ID", raw.linear?.agentId)
  const maxAttempts = raw.maxAttempts ?? DEFAULTS.maxAttempts
  const checks = Array.isArray(raw.checks) ? raw.checks : [...DEFAULTS.checks]

  // Validate required fields
  const missing: string[] = []
  if (!repoPath) missing.push("repoPath (env: RALPHLY_REPO_PATH)")
  if (!apiKey) missing.push("linear.apiKey (env: LINEAR_API_KEY)")
  if (!agentId) missing.push("linear.agentId (env: LINEAR_AGENT_ID)")

  if (missing.length > 0) {
    return { ok: false, error: { missing } }
  }

  return {
    ok: true,
    config: {
      repoPath: repoPath!,
      linear: { apiKey: apiKey!, agentId: agentId! },
      maxAttempts,
      checks,
    },
  }
}

/**
 * Save a ralphly config file. Useful for `ralphly init`.
 */
export const saveConfig = (
  config: Partial<RawConfigFile>,
  workDir = process.cwd(),
): void => {
  const configDir = path.join(workDir, CONFIG_DIR)
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(
    path.join(configDir, CONFIG_FILE),
    JSON.stringify(config, null, 2) + "\n",
  )
}
