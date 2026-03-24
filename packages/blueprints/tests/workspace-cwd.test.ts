/**
 * ABOUTME: Workspace-vs-cwd contract tests.
 * Proves that agent execution and check commands run in the configured
 * workspace, NOT in the process launch directory (process.cwd()).
 *
 * Each test explicitly asserts that workspace !== process.cwd() to make
 * the "launched from a different directory" invariant visible and
 * unambiguous. This is the acceptance test for the workspace bug fix.
 *
 * These tests target primitives directly (agent, cmd). Workflow-level
 * workspace propagation is tested in the consuming apps (ralphe, ralphly).
 */

import { describe, test, expect, afterAll } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"

// ---------------------------------------------------------------------------
// Workspace that is guaranteed to differ from process.cwd()
// ---------------------------------------------------------------------------

const launchDir = process.cwd()
const workspace = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "bp-cwd-contract-")),
)

// Sanity: the test is only meaningful if these differ
if (workspace === launchDir) {
  throw new Error(
    "Test setup error: workspace must differ from process.cwd() " +
      `but both resolved to ${workspace}`,
  )
}

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Agent execution uses configured workspace
// ---------------------------------------------------------------------------

describe("agent executes in configured workspace, not launch cwd", () => {
  test("engine receives workspace, not process.cwd()", async () => {
    let receivedWorkDir: string | undefined

    const layer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDir = workDir
        return Effect.succeed({ response: "done" } satisfies AgentResult)
      },
    })

    await Effect.runPromise(
      Effect.provide(agent("implement feature", workspace), layer),
    )

    expect(receivedWorkDir).toBe(workspace)
    expect(receivedWorkDir).not.toBe(launchDir)
  })
})

// ---------------------------------------------------------------------------
// Check (cmd) execution uses configured workspace
// ---------------------------------------------------------------------------

describe("check commands execute in configured workspace, not launch cwd", () => {
  test("pwd returns workspace, not process.cwd()", async () => {
    const result = await Effect.runPromise(cmd("pwd", workspace))

    expect(result.stdout.trim()).toBe(workspace)
    expect(result.stdout.trim()).not.toBe(launchDir)
  })

  test("file created by check lands in workspace, not launch dir", async () => {
    const marker = `cwd-test-${Date.now()}.marker`

    await Effect.runPromise(cmd(`touch ${marker}`, workspace))

    expect(fs.existsSync(path.join(workspace, marker))).toBe(true)
    expect(fs.existsSync(path.join(launchDir, marker))).toBe(false)

    // Clean up
    fs.unlinkSync(path.join(workspace, marker))
  })
})
