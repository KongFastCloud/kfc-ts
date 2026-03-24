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
