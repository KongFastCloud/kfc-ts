/**
 * ABOUTME: OpenTelemetry tracing integration via Effect's built-in span model.
 * Uses @effect/opentelemetry to bridge Effect.withSpan spans to OTel, with
 * an OTLP/HTTP exporter targeting Axiom. All operations are fail-open: missing
 * config, init failures, or flush failures never prevent ralphe from running.
 *
 * Architecture:
 * - initTelemetry() sets up the global OTel TracerProvider (same fail-open contract)
 * - TracingLive is an Effect Layer that bridges Effect.withSpan → global OTel provider
 * - Effect.withSpan at call sites replaces the old custom withSpan wrapper
 * - Parent context propagation is handled natively by Effect's context model
 *
 * Reads AXIOM_TOKEN, AXIOM_DATASET, and AXIOM_DOMAIN from process.env
 * (populated by Bun's automatic .env.local loading from the repo root).
 *
 * Exposes:
 * - initTelemetry()     — call once at process startup
 * - shutdownTelemetry() — call once at process exit (best-effort flush)
 * - TracingLive         — Effect Layer bridging Effect.withSpan → OTel
 */

import { Layer } from "effect"
import { trace } from "@opentelemetry/api"
import * as EffectTracer from "@effect/opentelemetry/Tracer"
import * as EffectResource from "@effect/opentelemetry/Resource"

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
// Effect tracing layer
// ---------------------------------------------------------------------------

/**
 * Effect Layer that bridges Effect.withSpan → global OTel tracer provider.
 * When initTelemetry() has set up an Axiom exporter, spans flow to Axiom.
 * When unconfigured, the global OTel no-op tracer is used (zero-cost).
 *
 * Uses @effect/opentelemetry's Tracer.layerGlobal to read from the global
 * OTel provider, avoiding scope-managed provider lifecycle that would clear
 * in-memory exporters during testing.
 */
export const TracingLive: Layer.Layer<never> = EffectTracer.layerGlobal.pipe(
  Layer.provide(EffectResource.layer({ serviceName: "ralphe" })),
) as Layer.Layer<never>

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
