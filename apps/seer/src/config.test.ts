import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { validateGoogleChatAuth } from "./config.ts"
import { ConfigurationError } from "./errors.ts"

describe("validateGoogleChatAuth", () => {
  let savedCredentials: string | undefined
  let savedAdc: string | undefined

  beforeEach(() => {
    savedCredentials = process.env.GOOGLE_CHAT_CREDENTIALS
    savedAdc = process.env.GOOGLE_CHAT_USE_ADC
    delete process.env.GOOGLE_CHAT_CREDENTIALS
    delete process.env.GOOGLE_CHAT_USE_ADC
  })

  afterEach(() => {
    if (savedCredentials !== undefined) {
      process.env.GOOGLE_CHAT_CREDENTIALS = savedCredentials
    } else {
      delete process.env.GOOGLE_CHAT_CREDENTIALS
    }
    if (savedAdc !== undefined) {
      process.env.GOOGLE_CHAT_USE_ADC = savedAdc
    } else {
      delete process.env.GOOGLE_CHAT_USE_ADC
    }
  })

  it("throws ConfigurationError when neither env var is set", () => {
    assert.throws(() => validateGoogleChatAuth(), (err: unknown) => {
      assert(err instanceof ConfigurationError)
      assert.match(err.message, /Google Chat authentication is not configured/)
      assert.match(err.message, /GOOGLE_CHAT_CREDENTIALS/)
      assert.match(err.message, /GOOGLE_CHAT_USE_ADC/)
      assert.match(err.message, /README\.md/)
      return true
    })
  })

  it("passes when GOOGLE_CHAT_CREDENTIALS is set", () => {
    process.env.GOOGLE_CHAT_CREDENTIALS = '{"type":"service_account"}'
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("passes when GOOGLE_CHAT_USE_ADC is true", () => {
    process.env.GOOGLE_CHAT_USE_ADC = "true"
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("passes when GOOGLE_CHAT_USE_ADC is TRUE (case-insensitive)", () => {
    process.env.GOOGLE_CHAT_USE_ADC = "TRUE"
    assert.doesNotThrow(() => validateGoogleChatAuth())
  })

  it("throws when GOOGLE_CHAT_USE_ADC is set but not true", () => {
    process.env.GOOGLE_CHAT_USE_ADC = "false"
    assert.throws(() => validateGoogleChatAuth(), (err: unknown) => {
      assert(err instanceof ConfigurationError)
      return true
    })
  })
})
