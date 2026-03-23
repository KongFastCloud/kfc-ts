/**
 * ABOUTME: OpenTelemetry bootstrap for Axiom trace export.
 * Initializes a TracerProvider with an OTLP/HTTP exporter targeting Axiom.
 * All operations are fail-open: missing config, init failures, or flush
 * failures are logged but never prevent ralphe from running normally.
 *
 * Reads AXIOM_TOKEN, AXIOM_DATASET, and AXIOM_DOMAIN from process.env
 * (populated by Bun's automatic .env.local loading from the repo root).
 *
 * Exposes:
 * - initTelemetry()     — call once at process startup
 * - shutdownTelemetry() — call once at process exit (best-effort flush)
 * - getTracer()         — returns the app tracer (no-op when unconfigured)
 * - withSpan()          — wraps an Effect in an OTel span
 */

import { trace, type Tracer, type Span, SpanStatusCode } from "@opentelemetry/api"
import { Effect } from "effect"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface AxiomConfig {
  readonly token: string
  readonly dataset: string
  readonly domain: string
}

const readAxiomConfig = (): AxiomConfig | undefined => {
  const token = process.env.AXIOM_TOKEN
  const dataset = process.env.AXIOM_DATASET
  const domain = process.env.AXIOM_DOMAIN

  if (!token || !dataset || !domain) return undefined
  return { token, dataset, domain }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let tracerProvider: import("@opentelemetry/sdk-trace-base").BasicTracerProvider | undefined
let initialized = false

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Initialize the OpenTelemetry tracer provider and Axiom exporter.
 * Safe to call multiple times — subsequent calls are no-ops.
 * If configuration is missing or setup fails, tracing degrades to a no-op.
 */
export const initTelemetry = (): void => {
  if (initialized) return
  initialized = true

  const config = readAxiomConfig()
  if (!config) return // No config — silent no-op

  try {
    // Dynamic imports kept inside the try block so missing packages
    // also degrade gracefully (shouldn't happen after install, but belt-and-suspenders).
    const { BasicTracerProvider, SimpleSpanProcessor } =
      require("@opentelemetry/sdk-trace-base") as typeof import("@opentelemetry/sdk-trace-base")
    const { OTLPTraceExporter } =
      require("@opentelemetry/exporter-trace-otlp-http") as typeof import("@opentelemetry/exporter-trace-otlp-http")
    const { resourceFromAttributes } =
      require("@opentelemetry/resources") as typeof import("@opentelemetry/resources")
    const { ATTR_SERVICE_NAME } =
      require("@opentelemetry/semantic-conventions") as typeof import("@opentelemetry/semantic-conventions")

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "ralphe",
    })

    const exporter = new OTLPTraceExporter({
      url: `${config.domain}/v1/traces`,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Axiom-Dataset": config.dataset,
      },
    })

    const provider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    trace.setGlobalTracerProvider(provider)
    tracerProvider = provider

    // eslint-disable-next-line no-console
    console.error("[telemetry] OpenTelemetry initialized — exporting to Axiom")
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telemetry] Failed to initialize OpenTelemetry:", err)
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/** Flush pending spans and shut down the tracer provider (best-effort). */
export const shutdownTelemetry = async (): Promise<void> => {
  if (!tracerProvider) return
  try {
    await tracerProvider.forceFlush()
    await tracerProvider.shutdown()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telemetry] Telemetry shutdown error (non-fatal):", err)
  }
}

// ---------------------------------------------------------------------------
// Tracer access
// ---------------------------------------------------------------------------

const TRACER_NAME = "ralphe"

/** Return the ralphe tracer. Returns a no-op tracer when OTel is not configured. */
export const getTracer = (): Tracer => trace.getTracer(TRACER_NAME)

// ---------------------------------------------------------------------------
// Effect integration
// ---------------------------------------------------------------------------

/**
 * Wrap an Effect in an OpenTelemetry span.
 *
 * Creates a span before executing the effect, records errors on the span
 * if the effect fails, and ends the span when the effect completes.
 * If the tracer is a no-op (unconfigured), this is effectively zero-cost.
 */
export const withSpan = <A, E, R>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const tracer = getTracer()
    let span: Span | undefined

    try {
      span = tracer.startSpan(name, attributes ? { attributes } : undefined)
    } catch {
      // If span creation fails, run the effect without tracing
      return yield* effect
    }

    const result = yield* effect.pipe(
      Effect.tapError((err) =>
        Effect.sync(() => {
          try {
            span!.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
          } catch {
            // ignore span update failures
          }
        }),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          try {
            if (exit._tag === "Failure") {
              span!.setStatus({ code: SpanStatusCode.ERROR })
            }
            span!.end()
          } catch {
            // ignore span end failures
          }
        }),
      ),
    )

    return result
  })

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/**
 * Reset module state. Only for use in tests.
 */
export const _resetForTesting = (): void => {
  tracerProvider = undefined
  initialized = false
}
