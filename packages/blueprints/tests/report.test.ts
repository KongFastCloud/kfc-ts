/**
 * ABOUTME: Tests for the verification report step.
 * Verifies that report generation resolves paths relative to the explicit
 * workspace, passes workspace to the engine, and parses structured JSON.
 */

import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine.js"
import { report } from "../src/report.js"

const makeWorkspace = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-report-"))
  return fs.realpathSync(dir)
}

let workspace: string

afterEach(() => {
  if (workspace) {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

const successResponse = (reportPath?: string): string => {
  const obj = {
    success: true,
    report: "All checks passed.",
    ...(reportPath ? { reportPath } : {}),
  }
  return `Verification complete.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``
}

const failureResponse = (): string =>
  `Verification failed.\n\n\`\`\`json\n${JSON.stringify({
    success: false,
    report: "Feature is broken.",
  })}\n\`\`\``

describe("report", () => {
  test("creates reports directory relative to workspace", async () => {
    workspace = makeWorkspace()

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: successResponse() }),
    })

    await Effect.runPromise(
      Effect.provide(report("implement feature", workspace, "basic"), layer),
    )

    const reportsDir = path.join(workspace, ".blueprints/reports")
    expect(fs.existsSync(reportsDir)).toBe(true)
  })

  test("creates custom reports directory relative to workspace", async () => {
    workspace = makeWorkspace()
    const customDir = "custom-reports"

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: successResponse() }),
    })

    await Effect.runPromise(
      Effect.provide(
        report("implement feature", workspace, "basic", { reportsDir: customDir }),
        layer,
      ),
    )

    const reportsDir = path.join(workspace, customDir)
    expect(fs.existsSync(reportsDir)).toBe(true)
  })

  test("passes workspace to engine.execute as workDir", async () => {
    workspace = makeWorkspace()
    let receivedWorkDir: string | undefined

    const layer = Layer.succeed(Engine, {
      execute: (_prompt: string, workDir: string) => {
        receivedWorkDir = workDir
        return Effect.succeed({ response: successResponse() })
      },
    })

    await Effect.runPromise(
      Effect.provide(report("task", workspace, "basic"), layer),
    )

    expect(receivedWorkDir).toBe(workspace)
  })

  test("returns success result on passing verification", async () => {
    workspace = makeWorkspace()

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: successResponse("reports/check.md") }),
    })

    const result = await Effect.runPromise(
      Effect.provide(report("task", workspace, "basic"), layer),
    )

    expect(result.success).toBe(true)
    expect(result.report).toBe("All checks passed.")
    expect(result.reportPath).toBe("reports/check.md")
  })

  test("returns CheckFailure on failing verification", async () => {
    workspace = makeWorkspace()

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: failureResponse() }),
    })

    const exit = await Effect.runPromiseExit(
      Effect.provide(report("task", workspace, "basic"), layer),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("CheckFailure")
    }
  })

  test("handles missing JSON in agent response", async () => {
    workspace = makeWorkspace()

    const layer = Layer.succeed(Engine, {
      execute: () => Effect.succeed({ response: "No structured output here." }),
    })

    const exit = await Effect.runPromiseExit(
      Effect.provide(report("task", workspace, "basic"), layer),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("CheckFailure")
    }
  })

  test("includes browser instructions in prompt for browser mode", async () => {
    workspace = makeWorkspace()
    let receivedPrompt: string | undefined

    const layer = Layer.succeed(Engine, {
      execute: (prompt: string) => {
        receivedPrompt = prompt
        return Effect.succeed({ response: successResponse() })
      },
    })

    await Effect.runPromise(
      Effect.provide(report("task", workspace, "browser"), layer),
    )

    expect(receivedPrompt).toContain("agent-browser")
  })
})
