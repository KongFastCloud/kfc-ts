/**
 * Structured logger for seer.
 *
 * Thin wrapper for console logging with structured details.
 * Follows the same pattern as linear-agent-poc. Will be replaced
 * with an Effect-based logger in a later slice.
 */

const PREFIX = "[seer]"

export const log = (message: string, details?: Record<string, unknown>): void => {
  if (details) {
    console.log(`${PREFIX} ${message}`, details)
    return
  }
  console.log(`${PREFIX} ${message}`)
}
