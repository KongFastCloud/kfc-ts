import { describe, test, expect } from "bun:test"
import type { BeadsIssue } from "../src/beads.js"

// @ts-expect-error Bun test isolation import suffix is runtime-only.
const { buildPromptFromIssue } = await import("../src/beads.js?beadsTest") as typeof import("../src/beads.js")

describe("buildPromptFromIssue", () => {
  test("builds prompt with all fields", () => {
    const issue: BeadsIssue = {
      id: "task-1",
      title: "Add login page",
      description: "Create a login page with email and password fields.",
      design: "Use shadcn/ui form components.",
      acceptance_criteria: "- Login form renders\n- Validates email format",
      notes: "Check existing auth module.",
    }

    const prompt = buildPromptFromIssue(issue)

    expect(prompt).toContain("Add login page")
    expect(prompt).toContain("## Description")
    expect(prompt).toContain("Create a login page with email and password fields.")
    expect(prompt).toContain("## Design")
    expect(prompt).toContain("Use shadcn/ui form components.")
    expect(prompt).toContain("## Acceptance Criteria")
    expect(prompt).toContain("- Login form renders")
    expect(prompt).toContain("## Notes")
    expect(prompt).toContain("Check existing auth module.")
  })

  test("omits missing fields", () => {
    const issue: BeadsIssue = {
      id: "task-2",
      title: "Fix typo in README",
    }

    const prompt = buildPromptFromIssue(issue)

    expect(prompt).toBe("Fix typo in README")
    expect(prompt).not.toContain("## Description")
    expect(prompt).not.toContain("## Design")
    expect(prompt).not.toContain("## Acceptance Criteria")
    expect(prompt).not.toContain("## Notes")
  })

  test("includes only present fields in order", () => {
    const issue: BeadsIssue = {
      id: "task-3",
      title: "Refactor API",
      description: "Split into modules.",
      acceptance_criteria: "- Each module has own file",
    }

    const prompt = buildPromptFromIssue(issue)

    expect(prompt).toContain("Refactor API")
    expect(prompt).toContain("## Description")
    expect(prompt).toContain("## Acceptance Criteria")
    expect(prompt).not.toContain("## Design")
    expect(prompt).not.toContain("## Notes")

    // Verify order: description before acceptance_criteria
    const descIdx = prompt.indexOf("## Description")
    const acIdx = prompt.indexOf("## Acceptance Criteria")
    expect(descIdx).toBeLessThan(acIdx)
  })

  test("handles empty string fields as missing", () => {
    const issue: BeadsIssue = {
      id: "task-4",
      title: "Task with empty fields",
      description: "",
      design: undefined,
      notes: "",
    }

    const prompt = buildPromptFromIssue(issue)

    // Empty strings are falsy, so they should be omitted
    expect(prompt).toBe("Task with empty fields")
  })
})
