/**
 * ABOUTME: Tests for the mark-ready FIFO queue engine.
 * Covers: FIFO ordering, duplicate rejection, drain-after-failure,
 * doRefresh called after each completion, and pending-ID set correctness.
 */

import { describe, test, expect } from "bun:test"
import { MarkReadyQueueEngine } from "../src/tui/useMarkReadyQueue.js"
import type { RunMarkReady } from "../src/tui/useMarkReadyQueue.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a deferred promise so tests can control when each call resolves. */
function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Build a test harness around MarkReadyQueueEngine.
 *
 * `run` records every call and returns a deferred promise so the test
 * can control resolution timing.
 */
function setup() {
  const calls: Array<{ id: string; labels: string[] }> = []
  const gates: Array<ReturnType<typeof deferred>> = []
  const refreshCalls: number[] = [] // timestamps (index-based)
  let stateChanges = 0

  const run: RunMarkReady = (id, labels) => {
    const d = deferred()
    calls.push({ id, labels })
    gates.push(d)
    return d.promise as Promise<void>
  }

  const engine = new MarkReadyQueueEngine(
    run,
    () => refreshCalls.push(calls.length),
    () => stateChanges++,
  )

  return { engine, calls, gates, refreshCalls, stateChanges: () => stateChanges }
}

/** Flush pending microtasks so the engine's async drain loop can advance. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

// ---------------------------------------------------------------------------
// FIFO order
// ---------------------------------------------------------------------------

describe("MarkReadyQueueEngine", () => {
  test("drains items in FIFO order", async () => {
    const { engine, calls, gates } = setup()

    engine.enqueue({ id: "a", labels: ["x"] })
    engine.enqueue({ id: "b", labels: ["y"] })
    engine.enqueue({ id: "c", labels: ["z"] })

    // First item is dequeued immediately.
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.id).toBe("a")

    // Resolve first — second should start.
    gates[0]!.resolve(undefined)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.id).toBe("b")

    // Resolve second — third should start.
    gates[1]!.resolve(undefined)
    await flush()
    expect(calls).toHaveLength(3)
    expect(calls[2]!.id).toBe("c")

    // Resolve third — drain complete.
    gates[2]!.resolve(undefined)
    await flush()
    expect(engine.queueLength).toBe(0)
    expect(engine.inFlightId).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Duplicate rejection
  // -----------------------------------------------------------------------

  test("rejects duplicate task IDs already in the queue", async () => {
    const { engine, calls, gates } = setup()

    engine.enqueue({ id: "a", labels: ["x"] })
    engine.enqueue({ id: "b", labels: ["y"] })
    engine.enqueue({ id: "b", labels: ["y2"] }) // dup — should be rejected

    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.id).toBe("a")

    gates[0]!.resolve(undefined)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.id).toBe("b")

    gates[1]!.resolve(undefined)
    await flush()
    // Only 2 calls total — the duplicate was rejected.
    expect(calls).toHaveLength(2)
    expect(engine.queueLength).toBe(0)
  })

  test("rejects duplicate task IDs currently in-flight", async () => {
    const { engine, calls, gates } = setup()

    engine.enqueue({ id: "a", labels: ["x"] })
    await flush()
    expect(engine.inFlightId).toBe("a")

    // Try to enqueue "a" again while it's in-flight.
    engine.enqueue({ id: "a", labels: ["x2"] })
    expect(engine.queueLength).toBe(0)

    gates[0]!.resolve(undefined)
    await flush()
    // Only 1 call total.
    expect(calls).toHaveLength(1)
  })

  // -----------------------------------------------------------------------
  // doRefresh called after each completion
  // -----------------------------------------------------------------------

  test("calls doRefresh after each individual completion", async () => {
    const { engine, gates, refreshCalls } = setup()

    engine.enqueue({ id: "a", labels: [] })
    engine.enqueue({ id: "b", labels: [] })

    await flush()
    expect(refreshCalls).toHaveLength(0)

    gates[0]!.resolve(undefined)
    await flush()
    expect(refreshCalls).toHaveLength(1)

    gates[1]!.resolve(undefined)
    await flush()
    expect(refreshCalls).toHaveLength(2)
  })

  // -----------------------------------------------------------------------
  // Drain continues after failure
  // -----------------------------------------------------------------------

  test("silently swallows errors and continues draining", async () => {
    const { engine, calls, gates, refreshCalls } = setup()

    engine.enqueue({ id: "a", labels: [] })
    engine.enqueue({ id: "b", labels: [] })
    engine.enqueue({ id: "c", labels: [] })

    await flush()
    // Fail the first one.
    gates[0]!.reject(new Error("boom"))
    await flush()
    // doRefresh is still called after a failure.
    expect(refreshCalls).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.id).toBe("b")

    // Succeed the second.
    gates[1]!.resolve(undefined)
    await flush()
    expect(refreshCalls).toHaveLength(2)
    expect(calls[2]!.id).toBe("c")

    // Succeed the third.
    gates[2]!.resolve(undefined)
    await flush()
    expect(refreshCalls).toHaveLength(3)
    expect(engine.queueLength).toBe(0)
    expect(engine.inFlightId).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Pending ID set
  // -----------------------------------------------------------------------

  test("pendingIds includes both queued and in-flight IDs", async () => {
    const { engine, gates } = setup()

    engine.enqueue({ id: "a", labels: [] })
    engine.enqueue({ id: "b", labels: [] })
    engine.enqueue({ id: "c", labels: [] })

    await flush()
    // "a" is in-flight, "b" and "c" are queued.
    const pending = engine.pendingIds
    expect(pending.has("a")).toBe(true)
    expect(pending.has("b")).toBe(true)
    expect(pending.has("c")).toBe(true)
    expect(pending.size).toBe(3)

    // Complete "a" — only "b" and "c" remain.
    gates[0]!.resolve(undefined)
    await flush()
    const pending2 = engine.pendingIds
    expect(pending2.has("a")).toBe(false)
    expect(pending2.has("b")).toBe(true)
    expect(pending2.has("c")).toBe(true)

    // Complete all.
    gates[1]!.resolve(undefined)
    await flush()
    gates[2]!.resolve(undefined)
    await flush()
    expect(engine.pendingIds.size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Enqueue during drain
  // -----------------------------------------------------------------------

  test("items enqueued while drain is in progress are picked up", async () => {
    const { engine, calls, gates } = setup()

    engine.enqueue({ id: "a", labels: [] })
    await flush()
    expect(calls).toHaveLength(1)

    // Enqueue "b" while "a" is still in-flight.
    engine.enqueue({ id: "b", labels: ["late"] })

    gates[0]!.resolve(undefined)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.id).toBe("b")
    expect(calls[1]!.labels).toEqual(["late"])

    gates[1]!.resolve(undefined)
    await flush()
    expect(engine.pendingIds.size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Empty queue
  // -----------------------------------------------------------------------

  test("does nothing when queue is empty", async () => {
    const { engine, calls, refreshCalls } = setup()
    await flush()
    expect(calls).toHaveLength(0)
    expect(refreshCalls).toHaveLength(0)
    expect(engine.pendingIds.size).toBe(0)
  })
})
