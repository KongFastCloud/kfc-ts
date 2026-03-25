import fs from "node:fs"
import path from "node:path"

export interface DetectedCheck {
  readonly command: string
  readonly enabledByDefault: boolean
}

export interface DetectedProject {
  readonly language: string
  readonly packageManager: string
  readonly checks: DetectedCheck[]
}

export const detectProject = (workDir = process.cwd()): DetectedProject => {
  // Root package.json is the only supported auto-detection path.
  const packageJsonPath = path.join(workDir, "package.json")
  if (fs.existsSync(packageJsonPath)) {
    return detectNodeProject(workDir, packageJsonPath)
  }

  return { language: "", packageManager: "", checks: [] }
}

function detectPackageManager(workDir: string): string {
  if (fs.existsSync(path.join(workDir, "bun.lock")) || fs.existsSync(path.join(workDir, "bun.lockb"))) {
    return "bun"
  }
  if (fs.existsSync(path.join(workDir, "pnpm-lock.yaml"))) {
    return "pnpm"
  }
  if (fs.existsSync(path.join(workDir, "yarn.lock"))) {
    return "yarn"
  }
  return "npm"
}

/**
 * Scripts that are enabled by default in the config wizard.
 * These are common verification-oriented scripts that are safe to run
 * as post-agent checks. All other root scripts are shown but disabled
 * by default so maintainers opt in explicitly.
 */
const DEFAULT_ENABLED_SCRIPTS = new Set(["typecheck", "lint", "test"])

/**
 * Render a package.json script name into a runnable shell command
 * for the given package manager.
 *
 * Special case: bun uses `bun test` directly instead of `bun run test`.
 */
function renderCommand(scriptName: string, pm: string, runPrefix: string): string {
  if (scriptName === "test" && pm === "bun") {
    return "bun test"
  }
  return `${runPrefix} ${scriptName}`
}

function detectNodeProject(workDir: string, packageJsonPath: string): DetectedProject {
  const pm = detectPackageManager(workDir)
  const runPrefix = pm === "npm" ? "npm run" : `${pm} run`
  const checks: DetectedCheck[] = []

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
    const scripts = pkg.scripts || {}

    for (const name of Object.keys(scripts)) {
      checks.push({
        command: renderCommand(name, pm, runPrefix),
        enabledByDefault: DEFAULT_ENABLED_SCRIPTS.has(name),
      })
    }
  } catch {
    // ignore parse errors
  }

  return {
    language: fs.existsSync(path.join(workDir, "tsconfig.json")) ? "TypeScript" : "JavaScript",
    packageManager: pm,
    checks,
  }
}
