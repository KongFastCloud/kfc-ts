/**
 * ABOUTME: Tests for the epic domain model and validation logic.
 *
 * Owned contracts:
 *  1. validateEpicContext — label and body validation
 *  2. loadEpicContext    — parent resolution, validation, error messages
 *  3. buildEpicPreamble  — prompt preamble formatting
 */

import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import type { WatchTask } from "../src/beadsAdapter.js"
import {
  validateEpicContext,
  loadEpicContext,
  buildEpicPreamble,
  EPIC_ERROR_NO_PARENT,
  EPIC_ERROR_PARENT_NOT_FOUND,
  EPIC_ERROR_MISSING_LABEL,
  EPIC_ERROR_EMPTY_BODY,
  type EpicContext,
} from "../src/epic.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEpicIssue(overrides?: Partial<WatchTask>): WatchTask {
  return {
    id: "epic-1",
    title: "Implement user authentication",
    status: "backlog",
    description: "Full PRD content for user authentication feature.",
    labels: ["epic"],
    ...overrides,
  }
}

// ===========================================================================
// Contract 1: validateEpicContext
// ===========================================================================

describe("validateEpicContext", () => {
  test("valid epic with label and body returns Ok", () => {
    const issue = makeEpicIssue()
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.id).toBe("epic-1")
      expect(result.context.title).toBe("Implement user authentication")
      expect(result.context.body).toBe("Full PRD content for user authentication feature.")
      expect(result.context.labels).toContain("epic")
    }
  })

  test("issue without epic label returns Err", () => {
    const issue = makeEpicIssue({ labels: ["feature", "priority-high"] })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toContain("does not have the \"epic\" label")
      expect(result.reason).toContain("epic-1")
    }
  })

  test("issue with no labels returns Err", () => {
    const issue = makeEpicIssue({ labels: undefined })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toContain("does not have the \"epic\" label")
    }
  })

  test("issue with empty labels returns Err", () => {
    const issue = makeEpicIssue({ labels: [] })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toContain("does not have the \"epic\" label")
    }
  })

  test("epic with empty description returns Err", () => {
    const issue = makeEpicIssue({ description: "" })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toContain("no PRD body")
      expect(result.reason).toContain("epic-1")
    }
  })

  test("epic with undefined description returns Err", () => {
    const issue = makeEpicIssue({ description: undefined })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toContain("no PRD body")
    }
  })

  test("epic with whitespace-only description returns Err", () => {
    const issue = makeEpicIssue({ description: "   \n\t  " })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toContain("no PRD body")
    }
  })

  test("epic body is trimmed", () => {
    const issue = makeEpicIssue({ description: "  PRD content  " })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.body).toBe("PRD content")
    }
  })

  test("epic with multiple labels including epic is valid", () => {
    const issue = makeEpicIssue({ labels: ["priority-high", "epic", "v2"] })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.labels).toEqual(["priority-high", "epic", "v2"])
    }
  })
})

// ===========================================================================
// Contract 2: loadEpicContext
// ===========================================================================

describe("loadEpicContext", () => {
  test("no parentId fails with standalone error", async () => {
    const mockQuery = () => Effect.succeed(undefined)

    const result = await Effect.runPromise(
      loadEpicContext(undefined, mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_NO_PARENT)
    }
  })

  test("parent not found fails with not-found error", async () => {
    const mockQuery = () => Effect.succeed(undefined)

    const result = await Effect.runPromise(
      loadEpicContext("epic-99", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_PARENT_NOT_FOUND("epic-99"))
    }
  })

  test("parent without epic label fails with missing-label error", async () => {
    const mockQuery = () => Effect.succeed(makeEpicIssue({
      id: "parent-1",
      labels: ["feature"],
    }))

    const result = await Effect.runPromise(
      loadEpicContext("parent-1", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_MISSING_LABEL("parent-1"))
    }
  })

  test("parent with empty body fails with empty-body error", async () => {
    const mockQuery = () => Effect.succeed(makeEpicIssue({
      id: "parent-2",
      labels: ["epic"],
      description: "",
    }))

    const result = await Effect.runPromise(
      loadEpicContext("parent-2", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_EMPTY_BODY("parent-2"))
    }
  })

  test("valid parent returns EpicContext", async () => {
    const mockQuery = () => Effect.succeed(makeEpicIssue({
      id: "epic-ok",
      title: "Auth PRD",
      description: "Implement OAuth2 flow",
      labels: ["epic"],
    }))

    const result = await Effect.runPromise(
      loadEpicContext("epic-ok", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Right")
    if (result._tag === "Right") {
      const ctx: EpicContext = result.right
      expect(ctx.id).toBe("epic-ok")
      expect(ctx.title).toBe("Auth PRD")
      expect(ctx.body).toBe("Implement OAuth2 flow")
      expect(ctx.labels).toContain("epic")
    }
  })

  test("queryTaskDetail failure maps to not-found error", async () => {
    const mockQuery = () => Effect.fail({
      _tag: "FatalError" as const,
      command: "bd show",
      message: "not found",
    }) as any

    const result = await Effect.runPromise(
      loadEpicContext("epic-missing", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_PARENT_NOT_FOUND("epic-missing"))
    }
  })
})

// ===========================================================================
// Contract 3: buildEpicPreamble
// ===========================================================================

describe("buildEpicPreamble", () => {
  test("includes epic title and body", () => {
    const ctx: EpicContext = {
      id: "epic-1",
      title: "User Authentication",
      body: "Implement OAuth2 login flow with social providers.",
      labels: ["epic"],
    }

    const preamble = buildEpicPreamble(ctx)

    expect(preamble).toContain("## Epic: User Authentication")
    expect(preamble).toContain("Implement OAuth2 login flow with social providers.")
    expect(preamble).toContain("---")
  })

  test("preamble starts with epic heading", () => {
    const ctx: EpicContext = {
      id: "epic-2",
      title: "Database Migration",
      body: "Migrate from SQLite to Postgres.",
      labels: ["epic"],
    }

    const preamble = buildEpicPreamble(ctx)
    expect(preamble.startsWith("## Epic: Database Migration")).toBe(true)
  })
})
