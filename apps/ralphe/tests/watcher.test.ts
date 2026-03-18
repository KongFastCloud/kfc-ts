import { describe, test, expect } from "bun:test"
import { defaultWorkerId } from "../src/watcher.js"
import os from "node:os"

describe("watcher", () => {
  test("defaultWorkerId includes hostname", () => {
    const id = defaultWorkerId()
    expect(id).toBe(`ralphe-${os.hostname()}`)
  })

  test("defaultWorkerId returns consistent value", () => {
    const id1 = defaultWorkerId()
    const id2 = defaultWorkerId()
    expect(id1).toBe(id2)
  })
})
