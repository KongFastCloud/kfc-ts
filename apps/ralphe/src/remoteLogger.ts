/**
 * ABOUTME: Axiom remote log sink for shipping operational logs.
 * Buffers log entries in-memory and flushes them to Axiom's ingest API
 * asynchronously. Only ships info, warn, and error levels — debug stays
 * local-only. All operations are fail-open: missing config, init failures,
 * or network errors never prevent ralphe from running normally.
 *
 * Reads AXIOM_TOKEN, AXIOM_LOG_DATASET, and AXIOM_DOMAIN from process.env
 * (populated by Bun's automatic .env.local loading from the repo root).
 *
 * Exposes:
 * - initRemoteLogger()     — call once at process startup
 * - shutdownRemoteLogger() — call once at process exit (best-effort flush)
 * - getRemoteLogger()      — returns the Effect Logger (no-op when unconfigured)
 */

import { Logger, HashMap, LogLevel } from "effect"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface AxiomLogConfig {
  readonly token: string
  readonly dataset: string
  readonly domain: string
}

const readAxiomLogConfig = (): AxiomLogConfig | undefined => {
  const token = process.env.AXIOM_TOKEN
  const dataset = process.env.AXIOM_LOG_DATASET
  const domain = process.env.AXIOM_DOMAIN

  if (!token || !dataset || !domain) return undefined
  return { token, dataset, domain }
}

// ---------------------------------------------------------------------------
// Remote log level policy
// ---------------------------------------------------------------------------

/** Only info, warn, and error are eligible for remote shipping. */
const isRemoteEligible = (level: LogLevel.LogLevel): boolean =>
  level._tag === "Info" || level._tag === "Warning" || level._tag === "Error" ||
  level._tag === "Fatal"

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let config: AxiomLogConfig | undefined
let buffer: Array<Record<string, unknown>> = []
let initialized = false
let flushTimer: ReturnType<typeof setInterval> | undefined

/** Maximum entries to buffer before triggering a flush. */
const MAX_BUFFER_SIZE = 50

/** Flush interval in milliseconds. */
const FLUSH_INTERVAL_MS = 5_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMessage = (message: unknown): string => {
  if (typeof message === "string") return message
  if (Array.isArray(message)) return message.map(formatMessage).join(" ")
  return String(message)
}

const annotationsToRecord = (annotations: HashMap.HashMap<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of annotations) {
    result[key] = value
  }
  return result
}

// ---------------------------------------------------------------------------
// Remote field allowlist
// ---------------------------------------------------------------------------

/**
 * Mapping from annotation key → remote field name.
 * Only annotations whose key appears here are forwarded to Axiom.
 * Keys are normalized to the canonical remote contract names.
 */
const ALLOWED_ANNOTATION_MAP: Record<string, string> = {
  // Direct matches (annotation key === remote field name)
  "issue.id": "issue.id",
  engine: "engine",
  "check.name": "check.name",
  trace_id: "trace_id",
  span_id: "span_id",
  workerId: "workerId",

  // Normalized mappings (internal annotation key → canonical remote name)
  taskId: "issue.id",
  attempt: "loop.attempt",
  maxAttempts: "loop.max_attempts",

  // Direct dotted names (if callers already use the canonical form)
  "loop.attempt": "loop.attempt",
  "loop.max_attempts": "loop.max_attempts",
}

/**
 * Pick only the allowed annotation fields and map them to canonical remote names.
 * Any annotation key not in ALLOWED_ANNOTATION_MAP is silently dropped.
 */
const pickAllowedFields = (annotations: HashMap.HashMap<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of annotations) {
    const remoteName = ALLOWED_ANNOTATION_MAP[key]
    if (remoteName !== undefined) {
      result[remoteName] = value
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

const flush = async (entries: Array<Record<string, unknown>>): Promise<void> => {
  if (entries.length === 0 || !config) return

  try {
    const url = `${config.domain}/v1/datasets/${config.dataset}/ingest`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(entries),
    })

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[remote-logger] Axiom ingest failed (${response.status}): ${response.statusText}`,
      )
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[remote-logger] Axiom ingest error (non-fatal):", err)
  }
}

const drainBuffer = (): void => {
  if (buffer.length === 0) return
  const entries = buffer
  buffer = []
  // Fire-and-forget — failures are logged locally but never block
  void flush(entries)
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Initialize the remote Axiom log sink.
 * Safe to call multiple times — subsequent calls are no-ops.
 * If configuration is missing, remote logging degrades to a no-op.
 */
export const initRemoteLogger = (): void => {
  if (initialized) return
  initialized = true

  const cfg = readAxiomLogConfig()
  if (!cfg) return // No config — silent no-op

  try {
    config = cfg
    buffer = []

    // Periodic flush to avoid holding entries too long
    flushTimer = setInterval(drainBuffer, FLUSH_INTERVAL_MS)
    // Unref so the timer does not prevent process exit
    if (typeof flushTimer === "object" && "unref" in flushTimer) {
      flushTimer.unref()
    }

    // eslint-disable-next-line no-console
    console.error(`[remote-logger] Axiom log sink initialized — dataset: ${cfg.dataset}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[remote-logger] Failed to initialize Axiom log sink:", err)
    config = undefined
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/** Flush pending log entries (best-effort). */
export const shutdownRemoteLogger = async (): Promise<void> => {
  if (flushTimer !== undefined) {
    clearInterval(flushTimer)
    flushTimer = undefined
  }

  if (!config || buffer.length === 0) return

  try {
    await flush(buffer)
    buffer = []
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[remote-logger] Shutdown flush error (non-fatal):", err)
  }
}

// ---------------------------------------------------------------------------
// Effect Logger
// ---------------------------------------------------------------------------

/**
 * Returns an Effect Logger that buffers entries for Axiom shipping.
 * When unconfigured, this is a no-op logger that discards all entries.
 * Only info/warn/error/fatal levels are accepted; debug is filtered out.
 */
export const getRemoteLogger = (): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, annotations, date }) => {
    // Gate: only ship if configured and level is eligible
    if (!config || !isRemoteEligible(logLevel)) return

    const entry: Record<string, unknown> = {
      _time: date.toISOString(),
      level: logLevel.label,
      message: formatMessage(message),
      ...pickAllowedFields(annotations),
    }

    buffer.push(entry)

    // Eagerly flush when buffer is full
    if (buffer.length >= MAX_BUFFER_SIZE) {
      drainBuffer()
    }
  })

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/**
 * Reset module state. Only for use in tests.
 */
export const _resetForTesting = (): void => {
  if (flushTimer !== undefined) {
    clearInterval(flushTimer)
    flushTimer = undefined
  }
  config = undefined
  buffer = []
  initialized = false
}

/**
 * Return the current buffer contents. Only for use in tests.
 */
export const _getBufferForTesting = (): ReadonlyArray<Record<string, unknown>> => buffer
