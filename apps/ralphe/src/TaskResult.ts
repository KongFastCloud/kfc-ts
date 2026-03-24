/**
 * ABOUTME: Pure-data result type for a completed run.
 * Used by both the direct run path (buildRunWorkflow) and watch mode (runTask).
 */

export interface TaskResult {
  readonly success: boolean
  readonly resumeToken?: string | undefined
  readonly engine: "claude" | "codex"
  readonly error?: string | undefined
}
