/**
 * ABOUTME: Abstract Engine interface for pluggable execution backends.
 * Callers provide an Engine implementation (e.g. Claude SDK, Codex CLI)
 * via Effect's context/layer system. Blueprints is agnostic to which
 * concrete engine is used.
 */

import { Context, type Effect } from "effect"
import type { CheckFailure, FatalError } from "./errors.js"

export interface AgentResult {
  readonly response: string
  readonly resumeToken?: string | undefined
}

export interface Engine {
  readonly execute: (
    prompt: string,
    workDir: string,
  ) => Effect.Effect<AgentResult, CheckFailure | FatalError>
}

export const Engine = Context.GenericTag<Engine>("@blueprints/Engine")
