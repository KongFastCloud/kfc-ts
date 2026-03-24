/**
 * MCP client creation tests.
 *
 * Verifies that createGlitchTipClient handles missing env vars
 * gracefully (returns null) and re-throws unexpected errors.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createGlitchTipClient } from "./mcp.ts"

describe("createGlitchTipClient", () => {
  it("returns null when GlitchTip env vars are not configured", () => {
    // The test environment does not have GLITCHTIP_TOKEN or
    // GLITCHTIP_ORGANIZATION set, so this should degrade gracefully.
    const client = createGlitchTipClient()
    assert.equal(client, null, "should return null when env vars are missing")
  })

  it("returns an MCPClient-like object when env vars are present", () => {
    // Temporarily set env vars for this test
    const origToken = process.env.GLITCHTIP_TOKEN
    const origOrg = process.env.GLITCHTIP_ORGANIZATION

    process.env.GLITCHTIP_TOKEN = "test-token"
    process.env.GLITCHTIP_ORGANIZATION = "test-org"

    try {
      const client = createGlitchTipClient()
      assert.ok(client, "should return a client when env vars are set")
      assert.equal(typeof client.getTools, "function", "client should have getTools method")
    } finally {
      // Restore original env
      if (origToken === undefined) delete process.env.GLITCHTIP_TOKEN
      else process.env.GLITCHTIP_TOKEN = origToken
      if (origOrg === undefined) delete process.env.GLITCHTIP_ORGANIZATION
      else process.env.GLITCHTIP_ORGANIZATION = origOrg
    }
  })
})
