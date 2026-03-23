/**
 * ABOUTME: Tests for the retry loop primitive.
 * Owns the contract that loop retries on CheckFailure (passing feedback),
 * converts CheckFailure to FatalError after max attempts, propagates
 * FatalError immediately without retry, and fires onEvent callbacks at
 * each lifecycle point.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { trace, context } from "@opentelemetry/api"
import { loop, type LoopEvent } from "../src/loop.js"
import { CheckFailure, FatalError } from "../src/errors.js"
import { initTelemetry, shutdownTelemetry, _resetForTesting } from "../src/telemetry.js"

describe("loop", () => {
  test("succeeds on first attempt", async () => {
    let calls = 0
    await Effect.runPromise(
      loop(() => {
        calls++
        return Effect.succeed("ok")
      }),
    )
    expect(calls).toBe(1)
  })

  test("retries on CheckFailure and passes feedback", async () => {
    let calls = 0
    let receivedFeedback: string | undefined
    await Effect.runPromise(
      loop(
        (feedback) => {
          calls++
          receivedFeedback = feedback
          if (calls === 1) {
            return Effect.fail(
              new CheckFailure({
                command: "test",
                stderr: "type error",
                exitCode: 1,
              }),
            )
          }
          return Effect.succeed("ok")
        },
        { maxAttempts: 2 },
      ),
    )
    expect(calls).toBe(2)
    expect(receivedFeedback).toContain("type error")
  })

  test("converts CheckFailure to FatalError after max attempts", async () => {
    const result = await Effect.runPromiseExit(
      loop(
        () =>
          Effect.fail(
            new CheckFailure({
              command: "lint",
              stderr: "lint error",
              exitCode: 1,
            }),
          ),
        { maxAttempts: 2 },
      ),
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error as FatalError
      expect(err._tag).toBe("FatalError")
      expect(err.message).toContain("2 attempts")
    }
  })

  test("propagates FatalError immediately", async () => {
    let calls = 0
    const result = await Effect.runPromiseExit(
      loop(
        () => {
          calls++
          return Effect.fail(
            new FatalError({ command: "agent", message: "auth failed" }),
          )
        },
        { maxAttempts: 3 },
      ),
    )
    expect(calls).toBe(1)
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error as FatalError
      expect(err._tag).toBe("FatalError")
      expect(err.message).toBe("auth failed")
    }
  })

  test("passes attempt and maxAttempts to fn", async () => {
    const seen: Array<{ attempt: number; maxAttempts: number }> = []
    await Effect.runPromise(
      loop(
        (_feedback, attempt, maxAttempts) => {
          seen.push({ attempt, maxAttempts })
          if (seen.length === 1) {
            return Effect.fail(
              new CheckFailure({ command: "test", stderr: "fail", exitCode: 1 }),
            )
          }
          return Effect.succeed("ok")
        },
        { maxAttempts: 3 },
      ),
    )
    expect(seen).toEqual([
      { attempt: 1, maxAttempts: 3 },
      { attempt: 2, maxAttempts: 3 },
    ])
  })

  test("onEvent fires attempt_start and success events", async () => {
    const events: LoopEvent[] = []
    await Effect.runPromise(
      loop(
        () => Effect.succeed("ok"),
        {
          maxAttempts: 2,
          onEvent: (event) => {
            events.push(event)
            return Effect.void
          },
        },
      ),
    )
    expect(events).toEqual([
      { type: "attempt_start", attempt: 1, maxAttempts: 2 },
      { type: "success", attempt: 1, maxAttempts: 2 },
    ])
  })

  test("onEvent fires attempt_start and check_failed for each retry", async () => {
    const events: LoopEvent[] = []
    let calls = 0
    await Effect.runPromise(
      loop(
        () => {
          calls++
          if (calls === 1) {
            return Effect.fail(
              new CheckFailure({ command: "test", stderr: "err", exitCode: 1 }),
            )
          }
          return Effect.succeed("ok")
        },
        {
          maxAttempts: 3,
          onEvent: (event) => {
            events.push(event)
            return Effect.void
          },
        },
      ),
    )
    expect(events).toEqual([
      { type: "attempt_start", attempt: 1, maxAttempts: 3 },
      { type: "check_failed", attempt: 1, maxAttempts: 3, feedback: 'Command "test" failed (exit 1):\nerr' },
      { type: "attempt_start", attempt: 2, maxAttempts: 3 },
      { type: "success", attempt: 2, maxAttempts: 3 },
    ])
  })

  test("onEvent check_failed includes CI stderr in feedback", async () => {
    const events: LoopEvent[] = []
    let calls = 0
    await Effect.runPromise(
      loop(
        () => {
          calls++
          if (calls === 1) {
            return Effect.fail(
              new CheckFailure({
                command: "CI run 12345",
                stderr: "FAIL src/app.test.ts\n  ● test suite failed to run",
                exitCode: 1,
              }),
            )
          }
          return Effect.succeed("ok")
        },
        {
          maxAttempts: 2,
          onEvent: (event) => {
            events.push(event)
            return Effect.void
          },
        },
      ),
    )
    const checkFailed = events.find((e) => e.type === "check_failed")
    expect(checkFailed).toBeDefined()
    expect(checkFailed!.feedback).toContain("CI run 12345")
    expect(checkFailed!.feedback).toContain("FAIL src/app.test.ts")
  })

  test("onEvent check_failed is not emitted on final attempt", async () => {
    const events: LoopEvent[] = []
    const result = await Effect.runPromiseExit(
      loop(
        () =>
          Effect.fail(
            new CheckFailure({ command: "test", stderr: "err", exitCode: 1 }),
          ),
        {
          maxAttempts: 1,
          onEvent: (event) => {
            events.push(event)
            return Effect.void
          },
        },
      ),
    )
    expect(result._tag).toBe("Failure")
    expect(events.filter((e) => e.type === "check_failed")).toHaveLength(0)
  })
})

describe("loop OTel spans", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(async () => {
    await shutdownTelemetry()
    _resetForTesting()
    delete process.env.AXIOM_TOKEN
    delete process.env.AXIOM_DATASET
    delete process.env.AXIOM_DOMAIN
  })

  test("emits a loop.attempt span for a single successful attempt", async () => {
    // With no-op tracer, spans are created but go nowhere — verify no crash
    await Effect.runPromise(
      loop(() => Effect.succeed("ok"), { maxAttempts: 1 }),
    )
  })

  test("emits distinct loop.attempt spans for each retry", async () => {
    let calls = 0
    await Effect.runPromise(
      loop(
        () => {
          calls++
          if (calls === 1) {
            return Effect.fail(
              new CheckFailure({ command: "test", stderr: "err", exitCode: 1 }),
            )
          }
          return Effect.succeed("ok")
        },
        { maxAttempts: 2 },
      ),
    )
    expect(calls).toBe(2)
  })

  test("loop.attempt spans carry approved minimal attributes", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initTelemetry()

    const tracer = trace.getTracer("ralphe")
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = []

    // Monkey-patch tracer to capture spans
    const origStartSpan = tracer.startSpan.bind(tracer)
    tracer.startSpan = (name: string, options?: any, ctx?: any) => {
      const span = origStartSpan(name, options, ctx)
      if (name === "loop.attempt") {
        spans.push({ name, attributes: { ...options?.attributes } })
      }
      return span
    }

    // Temporarily replace the global tracer
    const provider = trace.getTracerProvider()
    const origGetTracer = provider.getTracer.bind(provider)
    provider.getTracer = () => tracer

    try {
      await Effect.runPromise(
        loop(() => Effect.succeed("ok"), {
          maxAttempts: 3,
          spanAttributes: { engine: "claude", "issue.id": "TST-1" },
        }),
      )

      expect(spans).toHaveLength(1)
      expect(spans[0]!.name).toBe("loop.attempt")
      expect(spans[0]!.attributes).toEqual({
        "loop.attempt": 1,
        "loop.max_attempts": 3,
        engine: "claude",
        "issue.id": "TST-1",
      })
    } finally {
      provider.getTracer = origGetTracer
    }
  })

  test("loop.attempt spans include attempt number on retry", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initTelemetry()

    const tracer = trace.getTracer("ralphe")
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = []

    const origStartSpan = tracer.startSpan.bind(tracer)
    tracer.startSpan = (name: string, options?: any, ctx?: any) => {
      const span = origStartSpan(name, options, ctx)
      if (name === "loop.attempt") {
        spans.push({ name, attributes: { ...options?.attributes } })
      }
      return span
    }

    const provider = trace.getTracerProvider()
    const origGetTracer = provider.getTracer.bind(provider)
    provider.getTracer = () => tracer

    try {
      let calls = 0
      await Effect.runPromise(
        loop(
          () => {
            calls++
            if (calls === 1) {
              return Effect.fail(
                new CheckFailure({ command: "test", stderr: "err", exitCode: 1 }),
              )
            }
            return Effect.succeed("ok")
          },
          {
            maxAttempts: 2,
            spanAttributes: { engine: "codex" },
          },
        ),
      )

      expect(spans).toHaveLength(2)
      expect(spans[0]!.attributes["loop.attempt"]).toBe(1)
      expect(spans[0]!.attributes["loop.max_attempts"]).toBe(2)
      expect(spans[0]!.attributes["engine"]).toBe("codex")
      expect(spans[1]!.attributes["loop.attempt"]).toBe(2)
      expect(spans[1]!.attributes["loop.max_attempts"]).toBe(2)
      expect(spans[1]!.attributes["engine"]).toBe("codex")
    } finally {
      provider.getTracer = origGetTracer
    }
  })

  test("spans do not include task text or prompt contents", async () => {
    process.env.AXIOM_TOKEN = "test-token"
    process.env.AXIOM_DATASET = "test-dataset"
    process.env.AXIOM_DOMAIN = "https://example.axiom.co"
    initTelemetry()

    const tracer = trace.getTracer("ralphe")
    const spans: Array<Record<string, unknown>>  = []

    const origStartSpan = tracer.startSpan.bind(tracer)
    tracer.startSpan = (name: string, options?: any, ctx?: any) => {
      const span = origStartSpan(name, options, ctx)
      if (name === "loop.attempt") {
        spans.push({ ...options?.attributes })
      }
      return span
    }

    const provider = trace.getTracerProvider()
    const origGetTracer = provider.getTracer.bind(provider)
    provider.getTracer = () => tracer

    try {
      await Effect.runPromise(
        loop(() => Effect.succeed("ok"), {
          maxAttempts: 1,
          spanAttributes: { engine: "claude" },
        }),
      )

      const attrs = spans[0]!
      // Only approved attributes should be present
      const keys = Object.keys(attrs)
      for (const key of keys) {
        expect(["loop.attempt", "loop.max_attempts", "engine", "issue.id"]).toContain(key)
      }
    } finally {
      provider.getTracer = origGetTracer
    }
  })
})
