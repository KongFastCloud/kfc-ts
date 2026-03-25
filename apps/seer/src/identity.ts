/**
 * Platform-qualified identity helpers.
 *
 * All thread and user identifiers are prefixed with their platform
 * so that downstream consumers (Mastra memory, logging, etc.) can
 * distinguish origins without additional context.
 *
 * Format: `<platform>:<raw-id>`
 *
 * Examples:
 *   gchat:spaces/ABC123/threads/xyz789
 *   gchat:users/112233
 *   discord:channel/99887766
 */

export type Platform = "gchat" | "discord"

export interface QualifiedId {
  /** The full qualified string, e.g. "gchat:users/112233" */
  readonly qualified: string
  /** The platform prefix */
  readonly platform: Platform
  /** The raw platform-native identifier */
  readonly raw: string
}

export const qualifyId = (platform: Platform, rawId: string): QualifiedId => ({
  qualified: `${platform}:${rawId}`,
  platform,
  raw: rawId,
})

export const qualifyThreadId = (platform: Platform, rawId: string): QualifiedId =>
  qualifyId(platform, rawId)

export const qualifyUserId = (platform: Platform, rawId: string): QualifiedId =>
  qualifyId(platform, rawId)
