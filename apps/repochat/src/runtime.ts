/**
 * Effect runtime for repochat.
 *
 * Builds the Layer graph and exposes a ManagedRuntime that is created
 * once at startup and shared across all HTTP requests. Each request
 * runs an Effect program through `runtime.runPromise(...)`.
 *
 * The agent layer is built asynchronously so MCP tools (e.g. GlitchTip)
 * can be fetched and bound before the first request is served.
 * ManagedRuntime handles this lazily — the layer is materialized on
 * the first `runPromise` call.
 */

import { Effect, Layer, Logger, ManagedRuntime } from "effect"
import type { ToolsInput } from "@mastra/core/agent"
import { RepochatAgent, makeRepochatAgent } from "./agent.ts"
import { createGlitchTipClient } from "./mcp.ts"

/**
 * Layer that provides the RepochatAgent service.
 *
 * Attempts to load GlitchTip MCP tools and bind them to the agent.
 * If GlitchTip is not configured (missing env vars) the agent is
 * created without tools — graceful degradation.
 */
const RepochatAgentLayer: Layer.Layer<RepochatAgent> = Layer.effect(
  RepochatAgent,
  Effect.gen(function* () {
    const client = createGlitchTipClient()

    if (!client) {
      yield* Effect.logInfo("GlitchTip MCP not configured — agent will operate without error inspection tools")
      return makeRepochatAgent()
    }

    const tools = yield* Effect.tryPromise(() => client.getTools() as Promise<ToolsInput>).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to load GlitchTip MCP tools, continuing without them").pipe(
          Effect.annotateLogs("cause", cause instanceof Error ? cause.message : String(cause)),
        ),
      ),
      Effect.catchAll(() => Effect.succeed(null)),
    )

    if (tools) {
      yield* Effect.logInfo("GlitchTip MCP tools loaded successfully")
      return makeRepochatAgent(tools)
    }

    return makeRepochatAgent()
  }),
)

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
