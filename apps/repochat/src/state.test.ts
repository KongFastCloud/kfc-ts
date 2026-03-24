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
})
