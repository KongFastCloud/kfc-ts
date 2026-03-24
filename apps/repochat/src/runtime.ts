/**
 * Effect runtime for repochat.
 *
 * Builds the Layer graph and exposes a ManagedRuntime that is created
 * once at startup and shared across all HTTP requests. Each request
 * runs an Effect program through `runtime.runPromise(...)`.
 */

import { Layer, Logger, ManagedRuntime } from "effect"
import { RepochatAgent, repochatAgent } from "./agent.ts"

/** Layer that provides the RepochatAgent service. */
const RepochatAgentLayer: Layer.Layer<RepochatAgent> =
  Layer.succeed(RepochatAgent, repochatAgent)

/** Structured logger with [repochat] prefix for Effect log calls. */
const LoggerLayer: Layer.Layer<never> = Logger.replace(
  Logger.defaultLogger,
  Logger.withLeveledConsole(Logger.logfmtLogger),
)

/** Full application layer combining all services. */
export const AppLayer: Layer.Layer<RepochatAgent> = RepochatAgentLayer.pipe(
  Layer.provideMerge(LoggerLayer),
)

/**
 * Managed runtime — created once, used for every request.
 *
 * Usage in handlers:
 *   const result = await runtime.runPromise(program)
 */
export const runtime = ManagedRuntime.make(AppLayer)
