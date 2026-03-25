/**
 * Git provider webhook adapter.
 *
 * Handles incoming webhook events from Git providers (GitHub, GitLab, etc.)
 * and signals the background reindex worker when the tracked branch is
 * updated.
 *
 * The handler returns immediately — sync and reindex happen asynchronously
 * in the background worker fiber.
 *
 * Authentication is intentionally deferred for v1. The webhook endpoint
 * relies on network-level access control (e.g. internal network, Cloud Run
 * IAM) rather than signature verification. This keeps the first slice
 * simple; signature verification can be added per-provider later.
 */

import { Effect, Logger } from "effect"
import { trackedBranch } from "../config.ts"
import { requestReindex } from "../reindex-worker.ts"

// ── Types ──

interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Normalised representation of a branch-update event.
 * Extracted from provider-specific payloads.
 */
interface BranchUpdateEvent {
  branch: string
  provider: string
}

// ── Public API ──

/**
 * Handle an incoming webhook request for tracked-branch updates.
 *
 * Parses the payload, checks if the event is relevant to the tracked
 * branch, and signals the background worker if so. Returns immediately
 * in all cases.
 */
export async function handleBranchUpdateWebhook(
  body: string,
  headers: Record<string, string>,
): Promise<WebhookResult> {
  const logLayer = Logger.replace(
    Logger.defaultLogger,
    Logger.withLeveledConsole(Logger.logfmtLogger),
  )

  const program = Effect.gen(function* () {
    // Parse the event from the provider-specific payload
    const event = yield* parseEvent(body, headers)

    if (!event) {
      yield* Effect.logInfo("Webhook received — not a recognised branch-update event")
      return { status: 200, body: { ok: true, action: "ignored" } }
    }

    const tracked = trackedBranch()

    yield* Effect.logInfo("Webhook branch-update event received").pipe(
      Effect.annotateLogs("eventBranch", event.branch),
      Effect.annotateLogs("trackedBranch", tracked),
      Effect.annotateLogs("provider", event.provider),
    )

    if (event.branch !== tracked) {
      yield* Effect.logInfo("Webhook event for non-tracked branch — ignoring")
      return { status: 200, body: { ok: true, action: "ignored", reason: "branch_mismatch" } }
    }

    // Signal the background worker (non-blocking)
    yield* requestReindex()

    return { status: 200, body: { ok: true, action: "reindex_requested" } }
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("Webhook handler error").pipe(
          Effect.annotateLogs("error", String(cause)),
        )
        return { status: 200 as const, body: { ok: true, action: "error_ignored" } }
      }),
    ),
  )

  return Effect.runPromise(program.pipe(Effect.provide(logLayer)))
}

// ── Payload parsing ──

/**
 * Parse a branch-update event from provider-specific payloads.
 *
 * Supports:
 *   - GitHub push events (X-GitHub-Event: push)
 *   - GitLab push events (X-Gitlab-Event: Push Hook)
 *   - Generic fallback: JSON body with { ref: "refs/heads/<branch>" }
 *
 * Returns null if the payload is not a recognised push/update event.
 */
const parseEvent = (
  body: string,
  headers: Record<string, string>,
): Effect.Effect<BranchUpdateEvent | null> =>
  Effect.gen(function* () {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body)
    } catch {
      yield* Effect.logWarning("Webhook body is not valid JSON")
      return null
    }

    // ── GitHub push ──
    const ghEvent = headers["x-github-event"]
    if (ghEvent) {
      if (ghEvent !== "push") {
        return null // Not a push event (could be PR, issue, etc.)
      }
      const ref = typeof parsed.ref === "string" ? parsed.ref : null
      if (!ref || !ref.startsWith("refs/heads/")) {
        return null
      }
      return { branch: ref.replace("refs/heads/", ""), provider: "github" }
    }

    // ── GitLab push ──
    const glEvent = headers["x-gitlab-event"]
    if (glEvent) {
      if (glEvent !== "Push Hook") {
        return null
      }
      const ref = typeof parsed.ref === "string" ? parsed.ref : null
      if (!ref || !ref.startsWith("refs/heads/")) {
        return null
      }
      return { branch: ref.replace("refs/heads/", ""), provider: "gitlab" }
    }

    // ── Generic fallback ──
    // Accept any JSON with a `ref` field in refs/heads/ format
    const ref = typeof parsed.ref === "string" ? parsed.ref : null
    if (ref && ref.startsWith("refs/heads/")) {
      return { branch: ref.replace("refs/heads/", ""), provider: "generic" }
    }

    return null
  })
