/**
 * ABOUTME: Local per-epic runtime bootstrap state persisted under `.ralphe`.
 * This state is intentionally local (not Beads metadata) so bootstrap status
 * does not pollute shared planning data and leaves no residue in worktrees.
 */

import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"
import { getRepoRoot, sanitizeEpicId } from "./epicWorktree.js"

export type EpicRuntimeStatus = "no_attempt" | "ready" | "error"

export interface EpicRuntimeState {
  readonly status: EpicRuntimeStatus
  readonly updatedAt?: string | undefined
  readonly lastError?: string | undefined
}

const RUNTIME_STATE_DIR = path.join(".ralphe", "epics")

const parseState = (raw: unknown): EpicRuntimeState | undefined => {
  if (!raw || typeof raw !== "object") return undefined
  const obj = raw as Record<string, unknown>
  const status = obj.status
  if (status !== "no_attempt" && status !== "ready" && status !== "error") {
    return undefined
  }
  return {
    status,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
    lastError: typeof obj.lastError === "string" ? obj.lastError : undefined,
  }
}

const getStatePath = (
  epicId: string,
): Effect.Effect<string, FatalError> =>
  getRepoRoot().pipe(
    Effect.map((repoRoot) =>
      path.join(repoRoot, RUNTIME_STATE_DIR, `${sanitizeEpicId(epicId)}.json`)
    ),
  )

export const readEpicRuntimeState = (
  epicId: string,
): Effect.Effect<EpicRuntimeState, FatalError> =>
  Effect.gen(function* () {
    const statePath = yield* getStatePath(epicId)
    if (!fs.existsSync(statePath)) {
      return { status: "no_attempt" as const }
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"))
      const state = parseState(parsed)
      if (!state) {
        return { status: "no_attempt" as const }
      }
      return state
    } catch {
      return { status: "no_attempt" as const }
    }
  })

export const getEpicRuntimeStatus = (
  epicId: string,
): Effect.Effect<EpicRuntimeStatus, FatalError> =>
  readEpicRuntimeState(epicId).pipe(Effect.map((state) => state.status))

export const setEpicRuntimeStatus = (
  epicId: string,
  status: EpicRuntimeStatus,
  lastError?: string,
): Effect.Effect<void, FatalError> =>
  Effect.gen(function* () {
    const statePath = yield* getStatePath(epicId)
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const payload: EpicRuntimeState = {
      status,
      updatedAt: new Date().toISOString(),
      ...(status === "error" && lastError ? { lastError } : {}),
    }
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + "\n")
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new FatalError({
          command: "setEpicRuntimeStatus",
          message: `Failed to write epic runtime state: ${
            defect instanceof Error ? defect.message : String(defect)
          }`,
        }),
      ),
    ),
  )

