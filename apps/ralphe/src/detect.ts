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
  // Node.js / TypeScript
  const packageJsonPath = path.join(workDir, "package.json")
  if (fs.existsSync(packageJsonPath)) {
    return detectNodeProject(workDir, packageJsonPath)
  }

  // Python
  if (
    fs.existsSync(path.join(workDir, "pyproject.toml")) ||
    fs.existsSync(path.join(workDir, "requirements.txt")) ||
    fs.existsSync(path.join(workDir, "setup.py"))
  ) {
    return detectPythonProject()
  }

  // Go
  if (fs.existsSync(path.join(workDir, "go.mod"))) {
    return detectGoProject()
  }

  // Rust
  if (fs.existsSync(path.join(workDir, "Cargo.toml"))) {
    return detectRustProject()
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

function detectNodeProject(workDir: string, packageJsonPath: string): DetectedProject {
  const pm = detectPackageManager(workDir)
  const run = pm === "npm" ? "npm run" : `${pm} run`
  const checks: DetectedCheck[] = []

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
    const scripts = pkg.scripts || {}

    if (scripts.typecheck) {
      checks.push({ command: `${run} typecheck`, enabledByDefault: true })
    }
    if (scripts.lint) {
      checks.push({ command: `${run} lint`, enabledByDefault: true })
    }
    if (scripts.test) {
      checks.push({ command: pm === "bun" ? "bun test" : `${run} test`, enabledByDefault: true })
    }
    if (scripts.build) {
      checks.push({ command: `${run} build`, enabledByDefault: false })
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

function detectPythonProject(): DetectedProject {
  return {
    language: "Python",
    packageManager: "pip",
    checks: [
      { command: "pytest", enabledByDefault: true },
      { command: "ruff check .", enabledByDefault: true },
      { command: "mypy .", enabledByDefault: false },
    ],
  }
}

function detectGoProject(): DetectedProject {
  return {
    language: "Go",
    packageManager: "go",
    checks: [
      { command: "go test ./...", enabledByDefault: true },
      { command: "golangci-lint run", enabledByDefault: true },
      { command: "go build ./...", enabledByDefault: false },
    ],
  }
}

function detectRustProject(): DetectedProject {
  return {
    language: "Rust",
    packageManager: "cargo",
    checks: [
      { command: "cargo test", enabledByDefault: true },
      { command: "cargo clippy", enabledByDefault: true },
      { command: "cargo build", enabledByDefault: false },
    ],
  }
}
