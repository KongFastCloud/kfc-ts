/**
 * Codemogger MCP registration tests.
 *
 * Verifies the registration shape and definition factory behavior
 * without starting an actual MCP server.
 */

import { describe, it, expect } from "vitest"
import { codemogger } from "./codemogger.ts"

describe("codemogger registration", () => {
  it("has the expected name and description", () => {
    expect(codemogger.name).toBe("codemogger")
    expect(codemogger.description).toContain("code search")
  })

  it("has no required env vars", () => {
    const required = codemogger.env.filter((e) => e.required)
    expect(required).toHaveLength(0)
  })

  it("declares CODEMOGGER_DB_PATH as optional", () => {
    const dbPath = codemogger.env.find((e) => e.name === "CODEMOGGER_DB_PATH")
    expect(dbPath).toBeDefined()
    expect(dbPath!.required).toBe(false)
  })

  it("creates a definition using npx codemogger mcp", () => {
    const def = codemogger.createDefinition({})
    expect(def.command).toBe("npx")
    expect(def.args).toContain("codemogger")
    expect(def.args).toContain("mcp")
  })

  it("omits --db flag when CODEMOGGER_DB_PATH is not set", () => {
    const def = codemogger.createDefinition({})
    expect(def.args).not.toContain("--db")
  })

  it("includes --db flag when CODEMOGGER_DB_PATH is set", () => {
    const def = codemogger.createDefinition({
      CODEMOGGER_DB_PATH: "/custom/path/index.db",
    })
    expect(def.args).toContain("--db")
    expect(def.args).toContain("/custom/path/index.db")
  })
})
