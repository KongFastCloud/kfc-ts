import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"

export interface SkillTarget {
  readonly name: "claude" | "codex"
  readonly path: string
}

export interface InstallGlobalSkillOptions {
  readonly homeDir?: string
  readonly codexHome?: string
  readonly skillContent?: string
}

export const RALPHE_SKILL_MARKDOWN = `---
name: ralphe
description: Use this skill only when the user explicitly asks to use \`ralphe\`, \`/ralphe\`, or to run a ralphe loop. It is a user-triggered skill for running the \`ralphe\` CLI in the current project.
---

# Use Ralphe

## What Ralphe Does

\`ralphe\` is a CLI that:

- accepts a task as text or from \`--file\`
- runs an AI coding engine (\`claude\` or \`codex\`)
- runs configured shell checks
- retries with failure feedback up to \`maxAttempts\`
- optionally runs a verification report step
- optionally stages, commits, and pushes changes

## When To Use This Skill

Use this skill only when the user explicitly asks to:

- use \`ralphe\` or \`/ralphe\`
- run a ralphe loop for a task
- configure \`ralphe\` before running a loop
- install the global \`ralphe\` skill with \`ralphe skill\`
- run a PRD or task file through \`ralphe run --file\`

Do not use this skill just because the user mentions checks, reports, codex, claude, or automation. If the user does not explicitly ask for \`ralphe\`, do not load this skill.

## Default Workflow

1. Confirm the user wants a ralphe loop and identify the task text or task file.
2. Check whether \`ralphe\` is available in the current shell.
3. If the project has no config yet, suggest running \`ralphe config\`.
4. Help the user choose checks that match the repo's existing scripts.
5. Run \`ralphe run\` with either a text task or \`--file\`.
6. If needed, explain retry behavior, reports, and git.mode options before enabling them.

## Core Commands

\`\`\`bash
ralphe config
ralphe run "fix the failing tests"
ralphe run --file PRD.md
ralphe run --engine codex "add input validation"
ralphe skill
\`\`\`
`

export const getGlobalSkillTargets = (
  homeDir = os.homedir(),
  codexHome = process.env.CODEX_HOME || path.join(homeDir, ".codex")
): SkillTarget[] => [
  { name: "claude", path: path.join(homeDir, ".claude", "skills", "ralphe") },
  { name: "codex", path: path.join(codexHome, "skills", "ralphe") },
]

const writeSkillDir = (targetDir: string, skillContent: string): void => {
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(path.join(targetDir, "SKILL.md"), `${skillContent.trim()}\n`)
}

export const installGlobalSkill = (
  opts?: InstallGlobalSkillOptions
): Effect.Effect<SkillTarget[], FatalError> =>
  Effect.try({
    try: () => {
      const targets = getGlobalSkillTargets(opts?.homeDir, opts?.codexHome)
      const skillContent = opts?.skillContent ?? RALPHE_SKILL_MARKDOWN

      for (const target of targets) {
        fs.mkdirSync(path.dirname(target.path), { recursive: true })
        fs.rmSync(target.path, { recursive: true, force: true })
        writeSkillDir(target.path, skillContent)
      }

      return targets
    },
    catch: (error) =>
      new FatalError({
        command: "skill",
        message: `Failed to install global skill: ${error}`,
      }),
  })
