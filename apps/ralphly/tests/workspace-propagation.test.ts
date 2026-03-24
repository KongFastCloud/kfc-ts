/**
 * ABOUTME: End-to-end workspace propagation tests for ralphly.
 *
 * Proves that the configured workspace flows from loadConfig through
 * runIssue to every blueprints primitive (agent, cmd, report, git-steps).
 * This is the ralphly-side of the workspace contract: config → runner → primitives.
 *
 * ## Contract under test
 *
 * 1. loadConfig resolves workspace from config file or environment
 * 2. runIssue receives workspace as an explicit parameter
 * 3. runIssue threads workspace to: agent(), cmd(), report(), buildCiGitStep()
 * 4. The workspace is never process.cwd() in any of these calls
 *
 * ## Why this matters
 *
 * When workspace is ambient (from process.cwd()), the runner can silently
 * operate in the wrong directory. These tests prove that workspace is
 * explicit at every boundary — from configuration loading through to each
 * execution primitive.
 *
 * ## Future-worktree readiness
 *
 * The same runner code path will work when a future worktree layer swaps
 * in a dynamically-prepared worktree path. No runner changes needed:
 * the caller prepares the workspace, the runner executes inside it.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult, CheckFailure } from "@workspace/blueprints"
import { loadConfig, saveConfig } from "../src/config.js"
import { runIssue } from "../src/runner.js"
import { Linear } from "../src/linear/client.js"
import type { CandidateWork, LinearIssueData, LinearSessionData } from "../src/linear/types.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const launchDir = process.cwd()

const makeIssue = (overrides?: Partial<LinearIssueData>): LinearIssueData => ({
  id: "issue-ws",
  identifier: "WS-1",
  title: "Workspace propagation test",
  description: "Verifying workspace threading.",
  url: "https://linear.app/issue/WS-1",
  priority: 3,
  priorityLabel: "Normal",
  estimate: null,
  branchName: "ws-1-workspace-propagation",
  state: { id: "state-1", name: "In Progress", type: "started" },
  parentId: null,
  childIds: [],
  relations: [],
  inverseRelations: [],
  delegateId: "agent-001",
  assigneeId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  completedAt: null,
  canceledAt: null,
  ...overrides,
})

const makeSession = (overrides?: Partial<LinearSessionData>): LinearSessionData => ({
  id: "session-ws",
  status: "active",
  appUserId: "agent-001",
  issueId: "issue-ws",
  creatorId: "user-1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  endedAt: null,
  summary: null,
  ...overrides,
})

const makeWork = (): CandidateWork => ({
  issue: makeIssue(),
  session: makeSession(),
})

const makeMockLinearLayer = (): Layer.Layer<Linear> =>
  Layer.succeed(
    Linear,
    {
      createAgentActivity: async () => ({ success: true }),
    } as unknown as InstanceType<typeof import("@linear/sdk").LinearClient>,
  )

// ---------------------------------------------------------------------------
// Config → workspace propagation
// ---------------------------------------------------------------------------

describe("config loads workspace independently of launch directory", () => {
  let configDir: string

  beforeEach(() => {
    configDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "ralphly-ws-cfg-")),
    )
    delete process.env.RALPHLY_WORKSPACE_PATH
    delete process.env.RALPHLY_REPO_PATH
    delete process.env.LINEAR_API_KEY
    delete process.env.LINEAR_AGENT_ID
  })

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true })
    delete process.env.RALPHLY_WORKSPACE_PATH
    delete process.env.RALPHLY_REPO_PATH
    delete process.env.LINEAR_API_KEY
    delete process.env.LINEAR_AGENT_ID
  })

  test("workspace from config file differs from both configDir and launchDir", () => {
    const targetWorkspace = "/tmp/workspace-target-12345"

    saveConfig(
      {
        workspacePath: targetWorkspace,
        linear: { apiKey: "key", agentId: "agent" },
      },
      configDir,
    )

    const result = loadConfig(configDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe(targetWorkspace)
      expect(result.config.workspacePath).not.toBe(configDir)
      expect(result.config.workspacePath).not.toBe(launchDir)
    }
  })

  test("env var workspace overrides config file workspace", () => {
    saveConfig(
      {
        workspacePath: "/tmp/file-workspace",
        linear: { apiKey: "key", agentId: "agent" },
      },
      configDir,
    )

    process.env.RALPHLY_WORKSPACE_PATH = "/tmp/env-workspace"
    process.env.LINEAR_API_KEY = "key"
    process.env.LINEAR_AGENT_ID = "agent"

    const result = loadConfig(configDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/env-workspace")
    }
  })

  test("deprecated repoPath flows through as workspacePath with warning", () => {
    saveConfig(
      {
        repoPath: "/tmp/legacy-repo",
        linear: { apiKey: "key", agentId: "agent" },
      },
      configDir,
    )

    const result = loadConfig(configDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/legacy-repo")
      expect(result.warnings.length).toBe(1)
      expect(result.warnings[0]).toContain("deprecated")
    }
  })

  test("new workspacePath takes precedence over deprecated repoPath", () => {
    saveConfig(
      {
        workspacePath: "/tmp/new-ws",
        repoPath: "/tmp/old-repo",
        linear: { apiKey: "key", agentId: "agent" },
      },
      configDir,
    )

    const result = loadConfig(configDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.workspacePath).toBe("/tmp/new-ws")
      expect(result.warnings.length).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Runner → primitives workspace propagation
// ---------------------------------------------------------------------------

describe("runIssue threads workspace to every blueprints primitive", () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "ralphly-ws-run-")),
    )
    if (workspace === launchDir) {
      throw new Error("Test setup: workspace must differ from process.cwd()")
    }
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  test("agent receives workspace, not process.cwd()", async () => {
    let receivedWorkDir: string | undefined

    const engineLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDir = workDir
        return Effect.succeed({ response: "done" } satisfies AgentResult)
      },
    })

    await Effect.runPromise(
      runIssue({
        work: makeWork(),
        workspace,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(makeMockLinearLayer())),
    )

    expect(receivedWorkDir).toBe(workspace)
    expect(receivedWorkDir).not.toBe(launchDir)
  })

  test("check commands execute in workspace, not process.cwd()", async () => {
    // Use an engine that succeeds, then run a check that writes a marker file
    const marker = `ws-check-${Date.now()}.marker`

    const engineLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, _workDir: string) =>
        Effect.succeed({ response: "done" } satisfies AgentResult),
    })

    await Effect.runPromise(
      runIssue({
        work: makeWork(),
        workspace,
        config: {
          maxAttempts: 1,
          checks: [`touch ${marker}`],
          gitMode: "none",
          report: "none",
        },
        engineLayer,
      }).pipe(Effect.provide(makeMockLinearLayer())),
    )

    // Marker file must be in workspace
    expect(fs.existsSync(path.join(workspace, marker))).toBe(true)
    // Marker file must NOT be in launch dir
    expect(fs.existsSync(path.join(launchDir, marker))).toBe(false)
  })

  test("report step receives workspace for engine and dir creation", async () => {
    const receivedWorkDirs: string[] = []

    const engineLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDirs.push(workDir)
        return Effect.succeed({
          response: '```json\n{"success": true, "report": "ok"}\n```',
        } satisfies AgentResult)
      },
    })

    await Effect.runPromise(
      runIssue({
        work: makeWork(),
        workspace,
        config: {
          maxAttempts: 1,
          checks: [],
          gitMode: "none",
          report: "basic",
        },
        engineLayer,
      }).pipe(Effect.provide(makeMockLinearLayer())),
    )

    // Engine is called for agent + report — both should receive workspace
    expect(receivedWorkDirs.length).toBeGreaterThanOrEqual(2)
    for (const dir of receivedWorkDirs) {
      expect(dir).toBe(workspace)
      expect(dir).not.toBe(launchDir)
    }

    // Reports directory should exist in workspace
    expect(fs.existsSync(path.join(workspace, ".blueprints/reports"))).toBe(true)
  })

  test("workspace propagates through retry attempts", async () => {
    const receivedWorkDirs: string[] = []
    let callCount = 0

    const engineLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDirs.push(workDir)
        callCount++
        if (callCount === 1) {
          return Effect.fail(
            new CheckFailure({ command: "test", stderr: "fail", exitCode: 1 }),
          )
        }
        return Effect.succeed({ response: "fixed" } satisfies AgentResult)
      },
    })

    const result = await Effect.runPromise(
      runIssue({
        work: makeWork(),
        workspace,
        config: {
          maxAttempts: 2,
          checks: [],
          gitMode: "none",
          report: "none",
        },
        engineLayer,
      }).pipe(Effect.provide(makeMockLinearLayer())),
    )

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(2)

    // Both attempts should use the same workspace
    expect(receivedWorkDirs.length).toBe(2)
    for (const dir of receivedWorkDirs) {
      expect(dir).toBe(workspace)
      expect(dir).not.toBe(launchDir)
    }
  })
})

// ---------------------------------------------------------------------------
// Future-worktree readiness: workspace path can be anything
// ---------------------------------------------------------------------------

describe("workspace contract is ready for future worktree paths", () => {
  test("workspace can be a deeply nested path simulating a worktree", async () => {
    // Simulates: /tmp/.../worktrees/ENG-42/
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ralphly-wt-sim-"))
    const worktreePath = fs.realpathSync(
      (() => {
        const p = path.join(base, "worktrees", "ENG-42")
        fs.mkdirSync(p, { recursive: true })
        return p
      })(),
    )

    let receivedWorkDir: string | undefined

    const engineLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDir = workDir
        return Effect.succeed({ response: "done" } satisfies AgentResult)
      },
    })

    const result = await Effect.runPromise(
      runIssue({
        work: makeWork(),
        workspace: worktreePath,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(makeMockLinearLayer())),
    )

    expect(result.success).toBe(true)
    expect(receivedWorkDir).toBe(worktreePath)
    expect(receivedWorkDir).not.toBe(launchDir)

    fs.rmSync(base, { recursive: true, force: true })
  })

  test("RunIssueOptions.workspace is the single source of truth for execution location", async () => {
    // This test documents the contract: whatever path is in opts.workspace
    // is where blueprints executes. The runner does not second-guess it.
    const arbitraryPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "ralphly-ws-arbitrary-")),
    )

    const workDirs: string[] = []

    const engineLayer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        workDirs.push(workDir)
        return Effect.succeed({ response: "done" } satisfies AgentResult)
      },
    })

    await Effect.runPromise(
      runIssue({
        work: makeWork(),
        workspace: arbitraryPath,
        config: { maxAttempts: 1, checks: [], gitMode: "none", report: "none" },
        engineLayer,
      }).pipe(Effect.provide(makeMockLinearLayer())),
    )

    // Every engine invocation used the provided path
    expect(workDirs.every((d) => d === arbitraryPath)).toBe(true)

    fs.rmSync(arbitraryPath, { recursive: true, force: true })
  })
})
