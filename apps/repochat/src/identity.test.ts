/**
 * Platform-qualified identity tests.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { qualifyId, qualifyThreadId, qualifyUserId } from "./identity.ts"

describe("identity", () => {
  it("qualifies a gchat thread id", () => {
    const id = qualifyThreadId("gchat", "spaces/ABC/threads/XYZ")
    assert.equal(id.qualified, "gchat:spaces/ABC/threads/XYZ")
    assert.equal(id.platform, "gchat")
    assert.equal(id.raw, "spaces/ABC/threads/XYZ")
  })

  it("qualifies a gchat user id", () => {
    const id = qualifyUserId("gchat", "users/112233")
    assert.equal(id.qualified, "gchat:users/112233")
    assert.equal(id.platform, "gchat")
    assert.equal(id.raw, "users/112233")
  })

  it("qualifies a discord id", () => {
    const id = qualifyId("discord", "channel/99887766")
    assert.equal(id.qualified, "discord:channel/99887766")
    assert.equal(id.platform, "discord")
  })

  it("different platforms produce different qualified ids for the same raw id", () => {
    const gchat = qualifyId("gchat", "123")
    const discord = qualifyId("discord", "123")
    assert.notEqual(gchat.qualified, discord.qualified)
  })
})
