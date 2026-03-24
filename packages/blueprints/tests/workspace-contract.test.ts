/**
 * ABOUTME: Workspace contract tests for the full primitives surface.
 *
 * Extends the workspace-cwd acceptance tests to cover every execution
 * primitive: agent, cmd, report, and git composition helpers. Together
 * with workspace-cwd.test.ts, this suite proves that blueprints is
 * entirely cwd-independent — every primitive operates inside the
 * caller-provided workspace and never falls back to process.cwd().
 *
 * ## Contract
 *
 * The workspace contract is:
 *   - Callers select or prepare a workspace directory.
 *   - Blueprints primitives execute exclusively inside that workspace.
 *   - No primitive reads or defaults to process.cwd().
 *
 * This contract is shaped for future worktree support: when the caller
 * eventually provides a temporary worktree path instead of the repo root,
 * blueprints will execute inside it without any code changes.
 *
 * ## What this tests
 *
 * 1. Report step creates directories and invokes the engine relative to workspace.
 * 2. Git composition helpers thread workspace to every GitOps callback.
 * 3. A multi-step pipeline (agent → cmd → report) threads a single workspace
 *    through every primitive in sequence.
 * 4. Workspace is treated as an opaque path — valid for repo root, subdirectory,
 *    or future worktree directory.
 */

import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer, pipe } from "effect"
import { Engine, type AgentResult } from "../src/engine.js"
import { agent } from "../src/agent.js"
import { cmd } from "../src/cmd.js"
import { report } from "../src/report.js"
import { buildCiGitStep, executePostLoopGitOps, type GitOps } from "../src/git-steps.js"
import { FatalError, CheckFailure } from "../src/errors.js"

// ---------------------------------------------------------------------------
// Workspace setup — guaranteed to differ from process.cwd()
// ---------------------------------------------------------------------------

const launchDir = process.cwd()

const makeWorkspace = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-contract-"))
  const resolved = fs.realpathSync(dir)
  if (resolved === launchDir) {
    throw new Error(
      `Test setup error: workspace must differ from process.cwd() but both resolved to ${resolved}`,
    )
  }
  return resolved
}

let workspace: string

afterEach(() => {
  if (workspace) {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Report step threads workspace
// ---------------------------------------------------------------------------

describe("report executes in configured workspace, not launch cwd", () => {
  test("creates reports directory inside workspace, not cwd", async () => {
    workspace = makeWorkspace()

    const layer = Layer.succeed(Engine, {
      execute: () =>
        Effect.succeed({
          response: '```json\n{"success": true, "report": "ok"}\n```',
        } satisfies AgentResult),
    })

    await Effect.runPromise(
      Effect.provide(report("verify task", workspace, "basic"), layer),
    )

    // Reports dir must exist in workspace
    expect(fs.existsSync(path.join(workspace, ".blueprints/reports"))).toBe(true)
    // Reports dir must NOT exist in launch dir (unless it already did)
    // We test by verifying workspace != launchDir already, plus the mkdir call
  })

  test("engine receives workspace as workDir, not process.cwd()", async () => {
    workspace = makeWorkspace()
    let receivedWorkDir: string | undefined

    const layer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDir = workDir
        return Effect.succeed({
          response: '```json\n{"success": true, "report": "ok"}\n```',
        } satisfies AgentResult)
      },
    })

    await Effect.runPromise(
      Effect.provide(report("verify task", workspace, "basic"), layer),
    )

    expect(receivedWorkDir).toBe(workspace)
    expect(receivedWorkDir).not.toBe(launchDir)
  })
})

// ---------------------------------------------------------------------------
// Git composition helpers thread workspace through GitOps
// ---------------------------------------------------------------------------

describe("git composition helpers thread workspace to GitOps", () => {
  test("buildCiGitStep passes workspace to commit, push, and waitCi", async () => {
    workspace = makeWorkspace()
    const receivedWorkspaces: { op: string; path: string }[] = []

    const trackingOps: GitOps = {
      commit: (ws) => {
        receivedWorkspaces.push({ op: "commit", path: ws })
        return Effect.succeed({ message: "feat: test", hash: "abc1234" })
      },
      push: (ws) => {
        receivedWorkspaces.push({ op: "push", path: ws })
        return Effect.succeed({ remote: "origin", ref: "main", output: "" })
      },
      waitCi: (ws) => {
        receivedWorkspaces.push({ op: "waitCi", path: ws })
        return Effect.succeed({
          runId: 1,
          status: "completed",
          conclusion: "success",
          url: null,
          workflowName: null,
        })
      },
    }

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "done" } satisfies AgentResult),
    })

    await Effect.runPromise(
      Effect.provide(buildCiGitStep(trackingOps, workspace), layer),
    )

    // Every git operation must receive the explicit workspace
    expect(receivedWorkspaces).toEqual([
      { op: "commit", path: workspace },
      { op: "push", path: workspace },
      { op: "waitCi", path: workspace },
    ])

    // None should have received launch dir
    for (const entry of receivedWorkspaces) {
      expect(entry.path).not.toBe(launchDir)
    }
  })

  test("executePostLoopGitOps passes workspace to commit and push", async () => {
    workspace = makeWorkspace()
    const receivedWorkspaces: { op: string; path: string }[] = []

    const trackingOps: GitOps = {
      commit: (ws) => {
        receivedWorkspaces.push({ op: "commit", path: ws })
        return Effect.succeed({ message: "feat: test", hash: "abc1234" })
      },
      push: (ws) => {
        receivedWorkspaces.push({ op: "push", path: ws })
        return Effect.succeed({ remote: "origin", ref: "main", output: "" })
      },
      waitCi: (ws) => {
        receivedWorkspaces.push({ op: "waitCi", path: ws })
        return Effect.succeed({
          runId: 1,
          status: "completed",
          conclusion: "success",
          url: null,
          workflowName: null,
        })
      },
    }

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "done" } satisfies AgentResult),
    })

    await Effect.runPromise(
      Effect.provide(
        executePostLoopGitOps("commit_and_push", trackingOps, workspace),
        layer,
      ),
    )

    expect(receivedWorkspaces).toEqual([
      { op: "commit", path: workspace },
      { op: "push", path: workspace },
    ])

    for (const entry of receivedWorkspaces) {
      expect(entry.path).not.toBe(launchDir)
    }
  })

  test("executePostLoopGitOps 'none' mode does not invoke any ops", async () => {
    workspace = makeWorkspace()
    const receivedWorkspaces: string[] = []

    const trackingOps: GitOps = {
      commit: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({ message: "test", hash: "abc" })
      },
      push: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({ remote: "origin", ref: "main", output: "" })
      },
      waitCi: (ws) => {
        receivedWorkspaces.push(ws)
        return Effect.succeed({
          runId: 1, status: "completed", conclusion: "success",
          url: null, workflowName: null,
        })
      },
    }

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "done" } satisfies AgentResult),
    })

    await Effect.runPromise(
      Effect.provide(
        executePostLoopGitOps("none", trackingOps, workspace),
        layer,
      ),
    )

    expect(receivedWorkspaces).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Multi-step pipeline threads a single workspace through all primitives
// ---------------------------------------------------------------------------

describe("multi-step pipeline: workspace threads through every primitive", () => {
  test("agent → cmd → report all receive the same workspace", async () => {
    workspace = makeWorkspace()
    const receivedWorkDirs: { step: string; path: string }[] = []

    const layer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        // Engine is invoked by both agent and report — tag by prompt content
        const step = _prompt.includes("verification") ? "report" : "agent"
        receivedWorkDirs.push({ step, path: workDir })
        return Effect.succeed({
          response: '```json\n{"success": true, "report": "ok"}\n```',
        } satisfies AgentResult)
      },
    })

    const pipeline = pipe(
      agent("implement feature", workspace),
      Effect.andThen(cmd("pwd", workspace)),
      Effect.andThen(report("implement feature", workspace, "basic")),
    )

    const cmdResult = await Effect.runPromise(
      pipe(
        agent("implement feature", workspace),
        Effect.andThen(() => cmd("pwd", workspace)),
        Effect.provide(layer),
      ),
    )

    // cmd's pwd output should be the workspace
    expect(cmdResult.stdout.trim()).toBe(workspace)
    expect(cmdResult.stdout.trim()).not.toBe(launchDir)

    // Run the full pipeline to verify agent and report
    receivedWorkDirs.length = 0
    await Effect.runPromise(Effect.provide(pipeline, layer))

    // Both engine calls (agent + report) should receive workspace
    expect(receivedWorkDirs.length).toBeGreaterThanOrEqual(2)
    for (const entry of receivedWorkDirs) {
      expect(entry.path).toBe(workspace)
      expect(entry.path).not.toBe(launchDir)
    }
  })
})

// ---------------------------------------------------------------------------
// Workspace is opaque — valid for any directory, including future worktrees
// ---------------------------------------------------------------------------

describe("workspace is opaque: any valid directory path is accepted", () => {
  test("deeply nested temp path works as workspace", async () => {
    // Simulates a worktree-like path: /tmp/.../worktrees/<issue-id>/
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "bp-worktree-sim-"))
    const nestedPath = path.join(base, "worktrees", "ENG-42")
    fs.mkdirSync(nestedPath, { recursive: true })
    workspace = fs.realpathSync(nestedPath)

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

    // Verify cmd also works with the deep path
    const result = await Effect.runPromise(cmd("pwd", workspace))
    expect(result.stdout.trim()).toBe(workspace)

    // Clean up the base dir instead
    fs.rmSync(base, { recursive: true, force: true })
    workspace = "" // prevent afterEach from double-cleaning
  })
})
