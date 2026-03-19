import { describe, expect, test } from "bun:test"
import type { RalpheConfig } from "../src/config.js"
import { resolveRunConfig } from "../cli.js"

const baseConfig: RalpheConfig = {
  engine: "claude",
  maxAttempts: 2,
  checks: [],
  git: { mode: "none" },
  report: "none",
}

describe("resolveRunConfig", () => {
  test("keeps config mode when no CLI override is provided", () => {
    const resolved = resolveRunConfig(baseConfig)
    expect(resolved.git.mode).toBe("none")
  })

  test("CLI git mode override takes precedence over config mode", () => {
    const resolved = resolveRunConfig(baseConfig, "commit_and_push")
    expect(resolved.git.mode).toBe("commit_and_push")
  })

  test("commit override is applied", () => {
    const resolved = resolveRunConfig(baseConfig, "commit")
    expect(resolved.git.mode).toBe("commit")
  })
})
