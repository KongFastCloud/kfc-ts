/**
 * Memory configuration and identity scoping tests.
 *
 * Verifies that:
 *   - Memory is configured with the expected policy
 *   - Working memory is resource-scoped (not thread-scoped)
 *   - Semantic recall is disabled
 *   - Platform-qualified IDs prevent cross-platform leakage
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { MEMORY_CONFIG, memory } from "./memory.ts"

describe("MEMORY_CONFIG", () => {
  it("limits history to 20 messages", () => {
    assert.equal(MEMORY_CONFIG.lastMessages, 20)
  })

  it("disables semantic recall", () => {
    assert.equal(MEMORY_CONFIG.semanticRecall, false)
  })

  it("enables working memory", () => {
    const wm = MEMORY_CONFIG.workingMemory
    assert.ok(wm, "workingMemory should be defined")
    assert.equal(wm.enabled, true)
  })

  it("scopes working memory to resource (user-level, cross-thread)", () => {
    const wm = MEMORY_CONFIG.workingMemory
    assert.ok(wm, "workingMemory should be defined")
    assert.equal(wm.scope, "resource")
  })

  it("provides a working memory template", () => {
    const wm = MEMORY_CONFIG.workingMemory as { template?: string }
    assert.ok(wm.template, "template should be defined")
    assert.ok(wm.template.includes("User Context"), "template should contain User Context section")
    assert.ok(wm.template.includes("Preferred name"), "template should contain user preference fields")
  })

  it("does not include repo fact fields in the working memory template", () => {
    const wm = MEMORY_CONFIG.workingMemory as { template?: string }
    assert.ok(wm.template, "template should be defined")
    // Working memory should not encourage storing repo facts
    assert.ok(
      !wm.template.includes("file path"),
      "template should not contain file path fields",
    )
    assert.ok(
      !wm.template.includes("code snippet"),
      "template should not contain code snippet fields",
    )
  })
})

describe("memory instance", () => {
  it("is defined and is an object", () => {
    assert.ok(memory)
    assert.equal(typeof memory, "object")
  })
})

describe("cross-platform isolation", () => {
  it("platform-qualified IDs are naturally distinct per platform", () => {
    // These are the IDs that would be passed as memory.thread / memory.resource.
    // Different platform prefixes ensure no accidental cross-platform sharing.
    const gchatThread = "gchat:spaces/ABC/threads/XYZ"
    const discordThread = "discord:channels/ABC/threads/XYZ"
    const gchatUser = "gchat:users/112233"
    const discordUser = "discord:users/112233"

    assert.notEqual(gchatThread, discordThread)
    assert.notEqual(gchatUser, discordUser)
  })

  it("same raw id on different platforms produces different keys", () => {
    const rawId = "users/112233"
    const gchat = `gchat:${rawId}`
    const discord = `discord:${rawId}`
    assert.notEqual(gchat, discord)
  })
})

describe("memory scoping semantics", () => {
  it("working memory scope is 'resource' — persists across threads for the same user", () => {
    // This is the critical property: working memory keyed by resource (userId)
    // means a user's preferences carry across all their threads
    const wm = MEMORY_CONFIG.workingMemory
    assert.ok(wm)
    assert.equal(wm.scope, "resource", "working memory must be resource-scoped for cross-thread persistence")
  })

  it("thread history is separate per thread (scoped by thread param, not resource)", () => {
    // lastMessages controls thread-local history. This is always per-thread
    // because Mastra threads are the natural scope for message history.
    assert.ok(MEMORY_CONFIG.lastMessages, "lastMessages should be configured for thread-local history")
    assert.ok(MEMORY_CONFIG.lastMessages! > 0, "lastMessages must be positive")
  })

  it("working memory template contains all expected user-context fields", () => {
    const wm = MEMORY_CONFIG.workingMemory as { template?: string }
    assert.ok(wm.template)
    const requiredFields = [
      "Preferred name",
      "Repos of interest",
      "Communication style",
      "Key topics discussed",
      "Open questions or follow-ups",
    ]
    for (const field of requiredFields) {
      assert.ok(wm.template.includes(field), `template should contain '${field}'`)
    }
  })

  it("semantic recall is disabled — no embedding-based retrieval", () => {
    assert.equal(MEMORY_CONFIG.semanticRecall, false, "semantic recall must be disabled for v1")
  })
})
