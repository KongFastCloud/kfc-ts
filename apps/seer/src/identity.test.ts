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

  it("qualifyThreadId and qualifyUserId use the same format as qualifyId", () => {
    const generic = qualifyId("gchat", "spaces/X/threads/Y")
    const thread = qualifyThreadId("gchat", "spaces/X/threads/Y")
    assert.equal(generic.qualified, thread.qualified)
    assert.equal(generic.platform, thread.platform)
    assert.equal(generic.raw, thread.raw)
  })

  it("thread and user IDs from the same platform share the platform prefix", () => {
    const thread = qualifyThreadId("gchat", "spaces/X/threads/Y")
    const user = qualifyUserId("gchat", "users/112233")
    assert.ok(thread.qualified.startsWith("gchat:"))
    assert.ok(user.qualified.startsWith("gchat:"))
    assert.equal(thread.platform, user.platform)
  })

  it("same raw thread ID on different platforms produces isolated memory keys", () => {
    const gchat = qualifyThreadId("gchat", "spaces/X/threads/Y")
    const discord = qualifyThreadId("discord", "spaces/X/threads/Y")
    assert.notEqual(gchat.qualified, discord.qualified, "thread memory should be isolated by platform")
  })

  it("same raw user ID on different platforms produces isolated resource keys", () => {
    const gchat = qualifyUserId("gchat", "users/112233")
    const discord = qualifyUserId("discord", "users/112233")
    assert.notEqual(gchat.qualified, discord.qualified, "user memory should be isolated by platform")
  })
})
