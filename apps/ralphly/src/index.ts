/**
 * ABOUTME: Public API surface for ralphly.
 * Re-exports configuration types and loading for use by tests and future modules.
 */

export { loadConfig, saveConfig, getConfigPath } from "./config.js"
export type { RalphlyConfig, LinearIdentity, ConfigError } from "./config.js"
export { FatalError } from "./errors.js"
