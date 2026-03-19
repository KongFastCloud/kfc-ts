import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Engine, type AgentResult } from "../src/engine/Engine.js"
import type { CheckFailure, FatalError } from "../src/errors.js"

// @ts-expect-error Bun test isolation import suffix is runtime-only.
const { report } = await import("../src/report.js?reportTest") as typeof import("../src/report.js")

const mockEngine = (response: string): Layer.Layer<Engine> =>
  Layer.succeed(
    Engine,
    {
      execute: (_prompt: string, _workDir: string): Effect.Effect<AgentResult, CheckFailure | FatalError> =>
        Effect.succeed({ response }),
    } satisfies Engine,
  )

describe("report", () => {
  test("parses successful report", async () => {
    const response = `I verified the feature works.\n\n\`\`\`json\n{"success": true, "report": "Feature works correctly", "reportPath": ".ralphe/reports/report.md"}\n\`\`\``
    const result = await Effect.runPromise(
      report("add login", "basic").pipe(Effect.provide(mockEngine(response))),
    )
    expect(result.success).toBe(true)
    expect(result.report).toBe("Feature works correctly")
    expect(result.reportPath).toBe(".ralphe/reports/report.md")
  })

  test("failed report yields CheckFailure", async () => {
    const response = `The feature is broken.\n\n\`\`\`json\n{"success": false, "report": "Login button does not submit the form"}\n\`\`\``
    const result = await Effect.runPromiseExit(
      report("add login", "basic").pipe(Effect.provide(mockEngine(response))),
    )
    expect(result._tag).toBe("Failure")
  })

  test("missing JSON block yields CheckFailure", async () => {
    const response = "I checked the code and it looks fine."
    const result = await Effect.runPromiseExit(
      report("add login", "basic").pipe(Effect.provide(mockEngine(response))),
    )
    expect(result._tag).toBe("Failure")
  })

  test("invalid JSON yields CheckFailure", async () => {
    const response = "Done.\n\n```json\n{not valid json}\n```"
    const result = await Effect.runPromiseExit(
      report("add login", "basic").pipe(Effect.provide(mockEngine(response))),
    )
    expect(result._tag).toBe("Failure")
  })

  test("browser mode includes agent-browser instructions in prompt", async () => {
    let capturedPrompt = ""
    const layer = Layer.succeed(
      Engine,
      {
        execute: (prompt: string, _workDir: string): Effect.Effect<AgentResult, CheckFailure | FatalError> => {
          capturedPrompt = prompt
          return Effect.succeed({
            response: '```json\n{"success": true, "report": "OK"}\n```',
          })
        },
      } satisfies Engine,
    )

    await Effect.runPromise(report("add dashboard", "browser").pipe(Effect.provide(layer)))
    expect(capturedPrompt).toContain("agent-browser")
  })

  test("basic mode does not include agent-browser instructions", async () => {
    let capturedPrompt = ""
    const layer = Layer.succeed(
      Engine,
      {
        execute: (prompt: string, _workDir: string): Effect.Effect<AgentResult, CheckFailure | FatalError> => {
          capturedPrompt = prompt
          return Effect.succeed({
            response: '```json\n{"success": true, "report": "OK"}\n```',
          })
        },
      } satisfies Engine,
    )

    await Effect.runPromise(report("add CLI flag", "basic").pipe(Effect.provide(layer)))
    expect(capturedPrompt).not.toContain("agent-browser")
  })
})
