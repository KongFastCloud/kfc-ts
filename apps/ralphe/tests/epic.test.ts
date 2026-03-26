/**
 * ABOUTME: Tests for the epic domain model and validation logic.
 *
 * Owned contracts:
 *  1. validateEpicContext — label, body, and branch validation
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
  EPIC_ERROR_NOT_EPIC,
  EPIC_ERROR_EMPTY_BODY,
  EPIC_ERROR_MISSING_BRANCH,
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
    issueType: "epic",
    labels: ["epic"],
    branch: "epic/user-auth",
    ...overrides,
  }
}

// ===========================================================================
// Contract 1: validateEpicContext
// ===========================================================================

describe("validateEpicContext", () => {
  test("valid epic with label, body, and branch returns Ok", () => {
    const issue = makeEpicIssue()
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.id).toBe("epic-1")
      expect(result.context.title).toBe("Implement user authentication")
      expect(result.context.body).toBe("Full PRD content for user authentication feature.")
      expect(result.context.labels).toContain("epic")
      expect(result.context.branch).toBe("epic/user-auth")
    }
  })

  test("issue with epic type and no epic label is still valid", () => {
    const issue = makeEpicIssue({ labels: ["feature", "priority-high"] })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.id).toBe("epic-1")
    }
  })

  test("issue with no labels is still valid when Beads type is epic", () => {
    const issue = makeEpicIssue({ labels: undefined })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.id).toBe("epic-1")
    }
  })

  test("issue with empty labels is still valid when Beads type is epic", () => {
    const issue = makeEpicIssue({ labels: [] })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
  })

  test("issue without epic type or epic label returns Err", () => {
    const issue = makeEpicIssue({
      issueType: "task",
      labels: ["feature", "priority-high"],
    })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toBe(EPIC_ERROR_NOT_EPIC("epic-1"))
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

  // Branch validation tests

  test("epic with no branch returns Err", () => {
    const issue = makeEpicIssue({ branch: undefined })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toBe(EPIC_ERROR_MISSING_BRANCH("epic-1"))
      expect(result.reason).toContain("no canonical branch")
    }
  })

  test("epic with empty branch returns Err", () => {
    const issue = makeEpicIssue({ branch: "" })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toBe(EPIC_ERROR_MISSING_BRANCH("epic-1"))
    }
  })

  test("epic with whitespace-only branch returns Err", () => {
    const issue = makeEpicIssue({ branch: "   " })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Err")
    if (result._tag === "Err") {
      expect(result.reason).toBe(EPIC_ERROR_MISSING_BRANCH("epic-1"))
    }
  })

  test("epic branch is trimmed", () => {
    const issue = makeEpicIssue({ branch: "  epic/my-branch  " })
    const result = validateEpicContext(issue)

    expect(result._tag).toBe("Ok")
    if (result._tag === "Ok") {
      expect(result.context.branch).toBe("epic/my-branch")
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

  test("parent without epic type or label fails with not-epic error", async () => {
    const mockQuery = () => Effect.succeed(makeEpicIssue({
      id: "parent-1",
      issueType: "task",
      labels: ["feature"],
    }))

    const result = await Effect.runPromise(
      loadEpicContext("parent-1", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_NOT_EPIC("parent-1"))
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

  test("parent with no branch fails with missing-branch error", async () => {
    const mockQuery = () => Effect.succeed(makeEpicIssue({
      id: "parent-3",
      labels: ["epic"],
      description: "Valid PRD body",
      branch: undefined,
    }))

    const result = await Effect.runPromise(
      loadEpicContext("parent-3", mockQuery).pipe(Effect.either),
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBe(EPIC_ERROR_MISSING_BRANCH("parent-3"))
    }
  })

  test("valid parent returns EpicContext with branch", async () => {
    const mockQuery = () => Effect.succeed(makeEpicIssue({
      id: "epic-ok",
      title: "Auth PRD",
      description: "Implement OAuth2 flow",
      labels: ["epic"],
      branch: "epic/oauth2",
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
      expect(ctx.branch).toBe("epic/oauth2")
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
      branch: "epic/user-auth",
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
      branch: "epic/db-migration",
    }

    const preamble = buildEpicPreamble(ctx)
    expect(preamble.startsWith("## Epic: Database Migration")).toBe(true)
  })
})
