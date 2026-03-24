/**
 * Thread lock (state adapter) tests.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { acquireThreadLock } from "./state.ts"

describe("acquireThreadLock", () => {
  it("acquires and releases a lock", async () => {
    const release = await acquireThreadLock("test-lock-1")
    release()
  })

  it("serialises concurrent acquires on the same thread", async () => {
    const order: number[] = []

    const run = async (id: number) => {
      const release = await acquireThreadLock("test-serial")
      order.push(id)
      await new Promise((resolve) => setTimeout(resolve, 10))
      release()
    }

    await Promise.all([run(1), run(2)])

    assert.equal(order.length, 2)
    assert.equal(order[0], 1)
    assert.equal(order[1], 2)
  })

  it("allows concurrent acquires on different threads", async () => {
    const active = new Set<string>()
    let maxConcurrent = 0

    const run = async (threadId: string) => {
      const release = await acquireThreadLock(threadId)
      active.add(threadId)
      maxConcurrent = Math.max(maxConcurrent, active.size)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active.delete(threadId)
      release()
    }

    await Promise.all([run("concurrent-a"), run("concurrent-b")])

    assert.equal(maxConcurrent, 2)
  })

  it("serialises three concurrent acquires in FIFO order", async () => {
    const order: number[] = []

    const run = async (id: number) => {
      const release = await acquireThreadLock("test-triple-serial")
      order.push(id)
      await new Promise((resolve) => setTimeout(resolve, 5))
      release()
    }

    await Promise.all([run(1), run(2), run(3)])

    assert.deepEqual(order, [1, 2, 3], "three waiters should be serialised in arrival order")
  })

  it("lock is reusable after release (no stale state)", async () => {
    for (let i = 0; i < 3; i++) {
      const release = await acquireThreadLock("test-reuse")
      release()
    }
    // If we get here without hanging, the lock is properly reusable
  })

  it("release after error does not corrupt lock state", async () => {
    const order: number[] = []

    const runWithError = async (id: number, shouldThrow: boolean) => {
      const release = await acquireThreadLock("test-error-release")
      try {
        order.push(id)
        if (shouldThrow) throw new Error("simulated failure")
        await new Promise((resolve) => setTimeout(resolve, 5))
      } finally {
        release()
      }
    }

    // First request throws, second should still proceed
    await Promise.all([
      runWithError(1, true).catch(() => {}),
      runWithError(2, false),
    ])

    assert.equal(order.length, 2)
    assert.equal(order[0], 1, "erroring request should have run first")
    assert.equal(order[1], 2, "subsequent request should still proceed after error")
  })
})
