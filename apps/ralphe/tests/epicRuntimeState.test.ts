/**
 * ABOUTME: Tests for local per-epic runtime bootstrap state.
 * Verifies default behavior, persistence, and corruption fallback.
 */

import { describe, test, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import {
  readEpicRuntimeState,
  setEpicRuntimeStatus,
} from "../src/epicRuntimeState.js"
import { getRepoRoot, sanitizeEpicId } from "../src/epicWorktree.js"

const runtimeStatePath = async (epicId: string): Promise<string> => {
  const repoRoot = await Effect.runPromise(getRepoRoot())
  return path.join(repoRoot, ".ralphe", "epics", `${sanitizeEpicId(epicId)}.json`)
}

const cleanupStateFile = (statePath: string): void => {
  try {
    fs.unlinkSync(statePath)
  } catch {
    // Ignore missing files in cleanup.
  }
}

describe("epicRuntimeState", () => {
  test("read defaults to no_attempt when state file is missing", async () => {
    const epicId = `state-missing-${Date.now()}`
    const statePath = await runtimeStatePath(epicId)
    cleanupStateFile(statePath)

    const state = await Effect.runPromise(readEpicRuntimeState(epicId))
    expect(state.status).toBe("no_attempt")
  })

  test("set ready persists and can be read back", async () => {
    const epicId = `state-ready-${Date.now()}`
    const statePath = await runtimeStatePath(epicId)
    cleanupStateFile(statePath)

    await Effect.runPromise(setEpicRuntimeStatus(epicId, "ready"))
    const state = await Effect.runPromise(readEpicRuntimeState(epicId))

    expect(state.status).toBe("ready")
    expect(state.updatedAt).toBeTruthy()

    cleanupStateFile(statePath)
  })

  test("set error persists lastError for local diagnostics", async () => {
    const epicId = `state-error-${Date.now()}`
    const statePath = await runtimeStatePath(epicId)
    cleanupStateFile(statePath)

    await Effect.runPromise(setEpicRuntimeStatus(epicId, "error", "bootstrap failed"))
    const state = await Effect.runPromise(readEpicRuntimeState(epicId))

    expect(state.status).toBe("error")
    expect(state.lastError).toBe("bootstrap failed")
    expect(state.updatedAt).toBeTruthy()

    cleanupStateFile(statePath)
  })

  test("invalid JSON falls back to no_attempt", async () => {
    const epicId = `state-invalid-${Date.now()}`
    const statePath = await runtimeStatePath(epicId)
    cleanupStateFile(statePath)

    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, "{invalid", "utf-8")

    const state = await Effect.runPromise(readEpicRuntimeState(epicId))
    expect(state.status).toBe("no_attempt")

    cleanupStateFile(statePath)
  })
})
