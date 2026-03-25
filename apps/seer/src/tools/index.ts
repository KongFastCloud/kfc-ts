/**
 * Seer native tools.
 *
 * Tools defined here are created directly via @mastra/core rather than
 * loaded from an MCP server. They complement MCP-sourced tools (e.g.
 * codemogger, GlitchTip) by providing capabilities that are simpler to
 * implement as in-process functions.
 */

export { readFileTool } from "./read-file.ts"
