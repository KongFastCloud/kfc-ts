/**
 * Direct file-read tool for codebase grounding.
 *
 * Allows the seer agent to read exact source files after codemogger
 * retrieval, providing verification of search results against the actual
 * codebase. This is the "trust but verify" complement to semantic search.
 *
 * Security boundary:
 *   - Reads are scoped to a configurable repo root directory
 *     (REPOCHAT_REPO_ROOT, defaults to cwd).
 *   - Path traversal outside the root is rejected.
 *   - Only regular files are readable (no directories, symlinks outside root).
 *   - File size is capped to avoid unbounded memory usage.
 *
 * The tool returns the file content as a string with line numbers for
 * easy reference in agent responses.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { readFile, stat } from "node:fs/promises"
import { resolve, relative } from "node:path"

/** Maximum file size in bytes (256 KB). */
const MAX_FILE_SIZE = 256 * 1024

/** Maximum number of lines to return when a range is requested. */
const MAX_LINE_RANGE = 500

/**
 * Resolve the repo root directory.
 *
 * Uses REPOCHAT_REPO_ROOT if set, otherwise falls back to cwd.
 */
function getRepoRoot(): string {
  return process.env.REPOCHAT_REPO_ROOT || process.cwd()
}

/**
 * Validate that a resolved path is within the repo root.
 *
 * Prevents path traversal attacks (e.g. "../../../etc/passwd").
 */
function isWithinRoot(filePath: string, root: string): boolean {
  const rel = relative(root, filePath)
  return !rel.startsWith("..") && !resolve(root, rel).includes("\0")
}

/**
 * Format file content with line numbers for agent consumption.
 */
function addLineNumbers(
  content: string,
  startLine: number,
): string {
  const lines = content.split("\n")
  const pad = String(startLine + lines.length - 1).length
  return lines
    .map((line, i) => `${String(startLine + i).padStart(pad, " ")} | ${line}`)
    .join("\n")
}

export const readFileTool = createTool({
  id: "read_file",
  description: [
    "Read the contents of a source file from the repository.",
    "Use this after codemogger search to verify exact source code.",
    "Provide a path relative to the repository root.",
    "Optionally specify startLine and endLine to read a specific range.",
  ].join(" "),

  inputSchema: z.object({
    path: z
      .string()
      .describe("File path relative to the repository root (e.g. 'src/index.ts')."),
    startLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("First line to include (1-based). Omit to start from the beginning."),
    endLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Last line to include (1-based, inclusive). Omit to read to the end."),
  }),

  outputSchema: z.object({
    path: z.string(),
    content: z.string(),
    totalLines: z.number(),
    range: z.object({
      start: z.number(),
      end: z.number(),
    }),
  }),

  execute: async ({ context: { path: filePath, startLine, endLine } }) => {
    const root = getRepoRoot()
    const resolved = resolve(root, filePath)

    // Security: ensure path stays within repo root
    if (!isWithinRoot(resolved, root)) {
      throw new Error(
        `Path "${filePath}" resolves outside the repository root.`,
      )
    }

    // Verify the file exists and is a regular file
    let fileStat
    try {
      fileStat = await stat(resolved)
    } catch {
      throw new Error(`File not found: ${filePath}`)
    }

    if (!fileStat.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`)
    }

    // Guard against very large files
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large (${Math.round(fileStat.size / 1024)} KB). ` +
        `Maximum is ${MAX_FILE_SIZE / 1024} KB. Use startLine/endLine to read a range.`,
      )
    }

    const raw = await readFile(resolved, "utf-8")
    const allLines = raw.split("\n")
    const totalLines = allLines.length

    // Resolve line range
    const start = startLine ?? 1
    const end = endLine ?? totalLines
    const clampedStart = Math.max(1, Math.min(start, totalLines))
    const clampedEnd = Math.max(clampedStart, Math.min(end, totalLines))

    // Guard against unreasonably large ranges
    const rangeSize = clampedEnd - clampedStart + 1
    if (rangeSize > MAX_LINE_RANGE && startLine != null) {
      throw new Error(
        `Requested range is ${rangeSize} lines. Maximum is ${MAX_LINE_RANGE}. ` +
        `Narrow the range with startLine/endLine.`,
      )
    }

    const selectedLines = allLines.slice(clampedStart - 1, clampedEnd)
    const content = addLineNumbers(selectedLines.join("\n"), clampedStart)

    return {
      path: filePath,
      content,
      totalLines,
      range: { start: clampedStart, end: clampedEnd },
    }
  },
})
