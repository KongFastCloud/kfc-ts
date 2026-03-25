/**
 * Effect runtime for seer.
 *
 * Builds the Layer graph and exposes a ManagedRuntime that is created
 * once at startup and shared across all HTTP requests. Each request
 * runs an Effect program through `runtime.runPromise(...)`.
 *
 * The agent layer is built asynchronously so MCP tools (e.g. GlitchTip,
 * codemogger) and native tools (e.g. file-read) can be fetched and
 * bound before the first request is served. ManagedRuntime handles
 * this lazily — the layer is materialized on the first `runPromise` call.
 */

import { Effect, Layer, Logger, ManagedRuntime } from "effect"
import type { ToolsInput } from "@mastra/core/agent"
import { SeerAgent, makeSeerAgent } from "./agent.ts"
import { createGlitchTipClient, createCodemoggerClient } from "./mcp.ts"
import { readFileTool } from "./tools/index.ts"

/**
 * Attempt to load tools from an MCP client, returning null on failure.
 *
 * Logs a warning with the source name so operators can see which
 * integration degraded.
 */
function loadMCPTools(
  name: string,
  clientFactory: () => ReturnType<typeof createGlitchTipClient>,
) {
  return Effect.gen(function* () {
    const client = clientFactory()

    if (!client) {
      yield* Effect.logInfo(`${name} MCP not configured — skipping`)
      return null
    }

    const tools = yield* Effect.tryPromise(
      () => client.getTools() as Promise<ToolsInput>,
    ).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning(`Failed to load ${name} MCP tools, continuing without them`).pipe(
          Effect.annotateLogs("cause", cause instanceof Error ? cause.message : String(cause)),
        ),
      ),
      Effect.catchAll(() => Effect.succeed(null)),
    )

    if (tools) {
      yield* Effect.logInfo(`${name} MCP tools loaded successfully`)
    }

    return tools
  })
}

/**
 * Layer that provides the SeerAgent service.
 *
 * Attempts to load all available tool sources:
 *   - Codemogger MCP — semantic and keyword code search (grounding)
 *   - GlitchTip MCP  — production error inspection (optional)
 *   - Native tools    — direct file-read for source verification
 *
 * Missing or failed integrations degrade gracefully — the agent is
 * always created, with whatever tools were successfully loaded.
 */
const SeerAgentLayer: Layer.Layer<SeerAgent> = Layer.effect(
  SeerAgent,
  Effect.gen(function* () {
    const glitchtipTools = yield* loadMCPTools("GlitchTip", createGlitchTipClient)
    const codemoggerTools = yield* loadMCPTools("Codemogger", createCodemoggerClient)

    // Merge all available tools into a single map
    const allTools: ToolsInput = {
      ...(codemoggerTools ?? {}),
      ...(glitchtipTools ?? {}),
      // Native tools — always available
      read_file: readFileTool as unknown as ToolsInput[string],
    }

    const toolCount = Object.keys(allTools).length
    yield* Effect.logInfo(`Agent created with ${toolCount} tool(s)`).pipe(
      Effect.annotateLogs("tools", Object.keys(allTools).join(", ")),
    )

    return makeSeerAgent(allTools)
  }),
)

/** Structured logger with [seer] prefix for Effect log calls. */
const LoggerLayer: Layer.Layer<never> = Logger.replace(
  Logger.defaultLogger,
  Logger.withLeveledConsole(Logger.logfmtLogger),
)

/** Full application layer combining all services. */
export const AppLayer: Layer.Layer<SeerAgent> = SeerAgentLayer.pipe(
  Layer.provideMerge(LoggerLayer),
)

/**
 * Managed runtime — created once, used for every request.
 *
 * Usage in handlers:
 *   const result = await runtime.runPromise(program)
 */
export const runtime = ManagedRuntime.make(AppLayer)
