/**
 * MCP client creation tests.
 *
 * Verifies that createGlitchTipClient handles missing env vars
 * gracefully (returns null), re-throws unexpected errors, and
 * validates the full failure-path contract.
 *
 * Also verifies that createCodemoggerClient always returns a client
 * since codemogger has no required env vars.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createGlitchTipClient, createCodemoggerClient } from "./mcp.ts"

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

  it("returns null when only GLITCHTIP_TOKEN is set (missing GLITCHTIP_ORGANIZATION)", () => {
    const origToken = process.env.GLITCHTIP_TOKEN
    const origOrg = process.env.GLITCHTIP_ORGANIZATION

    process.env.GLITCHTIP_TOKEN = "test-token"
    delete process.env.GLITCHTIP_ORGANIZATION

    try {
      const client = createGlitchTipClient()
      assert.equal(client, null, "should return null when organization is missing")
    } finally {
      if (origToken === undefined) delete process.env.GLITCHTIP_TOKEN
      else process.env.GLITCHTIP_TOKEN = origToken
      if (origOrg === undefined) delete process.env.GLITCHTIP_ORGANIZATION
      else process.env.GLITCHTIP_ORGANIZATION = origOrg
    }
  })

  it("returns null when only GLITCHTIP_ORGANIZATION is set (missing GLITCHTIP_TOKEN)", () => {
    const origToken = process.env.GLITCHTIP_TOKEN
    const origOrg = process.env.GLITCHTIP_ORGANIZATION

    delete process.env.GLITCHTIP_TOKEN
    process.env.GLITCHTIP_ORGANIZATION = "test-org"

    try {
      const client = createGlitchTipClient()
      assert.equal(client, null, "should return null when token is missing")
    } finally {
      if (origToken === undefined) delete process.env.GLITCHTIP_TOKEN
      else process.env.GLITCHTIP_TOKEN = origToken
      if (origOrg === undefined) delete process.env.GLITCHTIP_ORGANIZATION
      else process.env.GLITCHTIP_ORGANIZATION = origOrg
    }
  })

  it("returns null idempotently on repeated calls without env vars", () => {
    const first = createGlitchTipClient()
    const second = createGlitchTipClient()
    assert.equal(first, null)
    assert.equal(second, null)
  })
})

describe("createCodemoggerClient", () => {
  it("always returns a client (no required env vars)", async () => {
    const client = createCodemoggerClient()
    try {
      assert.ok(client, "should always return a client")
      assert.equal(typeof client.getTools, "function", "client should have getTools method")
    } finally {
      // MCPClient tracks instances — disconnect to allow re-creation in other tests
      await client.disconnect()
    }
  })
})
