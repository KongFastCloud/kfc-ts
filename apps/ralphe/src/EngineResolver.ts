/**
 * ABOUTME: Effect service for resolving engine choice to a concrete Engine layer.
 * Decouples the workflow builder from direct knowledge of engine implementations.
 * The direct run path resolves engine selection through this service rather than
 * a mixed config bag.
 */

import { Context, Layer } from "effect"
import { Engine } from "./engine/Engine.js"
import { ClaudeEngineLayer } from "./engine/ClaudeEngine.js"
import { CodexEngineLayer } from "./engine/CodexEngine.js"

/**
 * Service that maps an engine name to its concrete Effect Layer.
 */
export interface EngineResolver {
  readonly resolve: (engine: "claude" | "codex") => Layer.Layer<Engine>
}

export const EngineResolver = Context.GenericTag<EngineResolver>("EngineResolver")

/**
 * Default resolver that maps to the real Claude and Codex engine layers.
 */
export const DefaultEngineResolver: EngineResolver = {
  resolve: (engine) =>
    engine === "codex" ? CodexEngineLayer : ClaudeEngineLayer,
}

export const DefaultEngineResolverLayer: Layer.Layer<EngineResolver> =
  Layer.succeed(EngineResolver, DefaultEngineResolver)
