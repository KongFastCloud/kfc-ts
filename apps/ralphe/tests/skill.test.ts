/**
 * ABOUTME: Tests for global skill installation.
 * Owns the contract that getGlobalSkillTargets returns correct paths for
 * claude and codex homes, and installGlobalSkill creates/replaces skill
 * directories (including symlink-to-directory upgrades) with SKILL.md content.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import {
  getGlobalSkillTargets,
  installGlobalSkill,
  RALPHE_SKILL_MARKDOWN,
} from "../src/skill.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-skill-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("getGlobalSkillTargets", () => {
  test("returns claude and codex install paths", () => {
    const homeDir = path.join(tmpDir, "home")
    const codexHome = path.join(tmpDir, "codex-home")

    expect(getGlobalSkillTargets(homeDir, codexHome)).toEqual([
      {
        name: "claude",
        path: path.join(homeDir, ".claude", "skills", "ralphe"),
      },
      { name: "codex", path: path.join(codexHome, "skills", "ralphe") },
    ])
  })
})

describe("installGlobalSkill", () => {
  test("installs the skill into global claude and codex locations", async () => {
    const homeDir = path.join(tmpDir, "home")
    const codexHome = path.join(tmpDir, "codex-home")

    const targets = await Effect.runPromise(
      installGlobalSkill({ homeDir, codexHome })
    )

    for (const target of targets) {
      expect(fs.existsSync(target.path)).toBe(true)
      expect(fs.lstatSync(target.path).isDirectory()).toBe(true)
      expect(fs.readFileSync(path.join(target.path, "SKILL.md"), "utf-8")).toBe(
        `${RALPHE_SKILL_MARKDOWN.trim()}\n`
      )
    }
  })

  test("replaces an existing installed skill when run again", async () => {
    const homeDir = path.join(tmpDir, "home")
    const codexHome = path.join(tmpDir, "codex-home")

    const claudeTarget = path.join(homeDir, ".claude", "skills", "ralphe")
    const codexTarget = path.join(codexHome, "skills", "ralphe")

    fs.mkdirSync(claudeTarget, { recursive: true })
    fs.writeFileSync(
      path.join(claudeTarget, "SKILL.md"),
      "# Old claude skill\n"
    )
    fs.mkdirSync(codexTarget, { recursive: true })
    fs.writeFileSync(path.join(codexTarget, "SKILL.md"), "# Old codex skill\n")

    const newSkill = "---\nname: ralphe\ndescription: test\n---\n\n# Replaced\n"

    await Effect.runPromise(
      installGlobalSkill({ homeDir, codexHome, skillContent: newSkill })
    )

    expect(fs.lstatSync(claudeTarget).isDirectory()).toBe(true)
    expect(fs.lstatSync(codexTarget).isDirectory()).toBe(true)
    expect(fs.readFileSync(path.join(claudeTarget, "SKILL.md"), "utf-8")).toBe(
      `${newSkill.trim()}\n`
    )
    expect(fs.readFileSync(path.join(codexTarget, "SKILL.md"), "utf-8")).toBe(
      `${newSkill.trim()}\n`
    )
  })

  test("replaces an existing symlink install with a real skill directory", async () => {
    const homeDir = path.join(tmpDir, "home")
    const codexHome = path.join(tmpDir, "codex-home")
    const oldSource = path.join(tmpDir, "old-source", "ralphe")

    fs.mkdirSync(oldSource, { recursive: true })
    fs.writeFileSync(path.join(oldSource, "SKILL.md"), "# Old linked skill\n")

    const claudeTarget = path.join(homeDir, ".claude", "skills", "ralphe")
    const codexTarget = path.join(codexHome, "skills", "ralphe")

    fs.mkdirSync(path.dirname(claudeTarget), { recursive: true })
    fs.mkdirSync(path.dirname(codexTarget), { recursive: true })
    fs.symlinkSync(oldSource, claudeTarget, "dir")
    fs.symlinkSync(oldSource, codexTarget, "dir")

    await Effect.runPromise(installGlobalSkill({ homeDir, codexHome }))

    expect(fs.lstatSync(claudeTarget).isDirectory()).toBe(true)
    expect(fs.lstatSync(codexTarget).isDirectory()).toBe(true)
    expect(fs.readFileSync(path.join(claudeTarget, "SKILL.md"), "utf-8")).toBe(
      `${RALPHE_SKILL_MARKDOWN.trim()}\n`
    )
    expect(fs.readFileSync(path.join(codexTarget, "SKILL.md"), "utf-8")).toBe(
      `${RALPHE_SKILL_MARKDOWN.trim()}\n`
    )
  })
})
