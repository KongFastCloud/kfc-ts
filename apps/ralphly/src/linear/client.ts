/**
 * ABOUTME: Linear SDK client factory for ralphly.
 * Creates and provides a LinearClient instance from configuration.
 * Uses Effect Context for dependency injection so tests can substitute
 * a mock client.
 */

import { Context, Effect, Layer } from "effect"
import { LinearClient } from "@linear/sdk"
import type { LinearIdentity } from "../config.js"

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

/**
 * Effect Context tag for the Linear client.
 * Callers depend on this tag; the concrete LinearClient is provided via a Layer.
 */
export class Linear extends Context.Tag("Linear")<Linear, LinearClient>() {}

// ---------------------------------------------------------------------------
// Layer constructors
// ---------------------------------------------------------------------------

/**
 * Build a Layer that provides a real LinearClient from identity config.
 */
export const makeLinearLayer = (identity: LinearIdentity): Layer.Layer<Linear> =>
  Layer.succeed(Linear, new LinearClient({ apiKey: identity.apiKey }))

/**
 * Build a Layer from an already-constructed LinearClient (useful for tests).
 */
export const makeLinearLayerFromClient = (client: LinearClient): Layer.Layer<Linear> =>
  Layer.succeed(Linear, client)
