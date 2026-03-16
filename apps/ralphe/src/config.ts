import fs from "node:fs"
import path from "node:path"

export interface RalpheConfig {
  readonly engine: "claude" | "codex"
  readonly maxAttempts: number
  readonly checks: string[]
  readonly autoCommit: boolean
  readonly report: "browser" | "basic" | "none"
}

const CONFIG_DIR = ".ralphe"
const CONFIG_FILE = "config.json"

const DEFAULTS: RalpheConfig = {
  engine: "claude",
  maxAttempts: 2,
  checks: [],
  autoCommit: false,
  report: "none",
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
    return {
      engine: raw.engine ?? DEFAULTS.engine,
      maxAttempts: raw.maxAttempts ?? DEFAULTS.maxAttempts,
      checks: Array.isArray(raw.checks) ? raw.checks : DEFAULTS.checks,
      autoCommit: raw.autoCommit ?? DEFAULTS.autoCommit,
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
