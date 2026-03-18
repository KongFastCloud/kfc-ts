import { Context, type Effect } from "effect"
import type { CheckFailure, FatalError } from "../errors.js"

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

export const Engine = Context.GenericTag<Engine>("Engine")
