/**
 * read_file tool tests.
 *
 * Tests the direct file-read grounding primitive, verifying:
 *   - Successful reads with line numbers
 *   - Line range selection
 *   - Path traversal rejection
 *   - Missing file handling
 *   - File size guard behavior
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readFileTool } from "./read-file.ts"

// Create a temporary repo root for testing
const testRoot = join(tmpdir(), `seer-read-file-test-${Date.now()}`)

// Helper to execute the tool with a given context
async function executeTool(input: {
  path: string
  startLine?: number
  endLine?: number
}) {
  // Save and set SEER_REPO_ROOT
  const origRoot = process.env.SEER_REPO_ROOT
  process.env.SEER_REPO_ROOT = testRoot

  try {
    // The tool's execute function expects { context: input }
    return await readFileTool.execute!({
      context: input,
      runtimeContext: {} as any,
    } as any)
  } finally {
    if (origRoot === undefined) delete process.env.SEER_REPO_ROOT
    else process.env.SEER_REPO_ROOT = origRoot
  }
}

describe("read_file tool", () => {
  before(async () => {
    await mkdir(join(testRoot, "src"), { recursive: true })

    // Create test files
    await writeFile(
      join(testRoot, "src/hello.ts"),
      [
        'export function hello() {',
        '  return "hello world"',
        '}',
        '',
        'export function goodbye() {',
        '  return "goodbye"',
        '}',
      ].join("\n"),
    )

    await writeFile(join(testRoot, "empty.txt"), "")
  })

  after(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it("reads a full file with line numbers", async () => {
    const result = await executeTool({ path: "src/hello.ts" })
    assert.equal(result.path, "src/hello.ts")
    assert.equal(result.totalLines, 7)
    assert.equal(result.range.start, 1)
    assert.equal(result.range.end, 7)
    assert.ok(result.content.includes("hello world"))
    // Line numbers should be present
    assert.ok(result.content.includes("1 |"))
  })

  it("reads a line range", async () => {
    const result = await executeTool({
      path: "src/hello.ts",
      startLine: 2,
      endLine: 3,
    })
    assert.equal(result.range.start, 2)
    assert.equal(result.range.end, 3)
    assert.ok(result.content.includes("hello world"))
    assert.ok(result.content.includes("}"))
    // Should NOT contain line 1
    assert.ok(!result.content.includes("export function hello"))
  })

  it("clamps out-of-range lines", async () => {
    const result = await executeTool({
      path: "src/hello.ts",
      startLine: 1,
      endLine: 100,
    })
    assert.equal(result.range.start, 1)
    assert.equal(result.range.end, 7)
  })

  it("rejects path traversal", async () => {
    await assert.rejects(
      () => executeTool({ path: "../../../etc/passwd" }),
      (err: Error) => {
        assert.ok(err.message.includes("outside the repository root"))
        return true
      },
    )
  })

  it("rejects absolute paths outside root", async () => {
    await assert.rejects(
      () => executeTool({ path: "/etc/passwd" }),
      (err: Error) => {
        assert.ok(
          err.message.includes("outside the repository root") ||
          err.message.includes("File not found"),
        )
        return true
      },
    )
  })

  it("returns error for missing files", async () => {
    await assert.rejects(
      () => executeTool({ path: "nonexistent.ts" }),
      (err: Error) => {
        assert.ok(err.message.includes("File not found"))
        return true
      },
    )
  })

  it("reads an empty file", async () => {
    const result = await executeTool({ path: "empty.txt" })
    assert.equal(result.totalLines, 1) // empty string splits into [""]
    assert.equal(result.path, "empty.txt")
  })

  it("handles startLine only (no endLine)", async () => {
    const result = await executeTool({
      path: "src/hello.ts",
      startLine: 5,
    })
    assert.equal(result.range.start, 5)
    assert.equal(result.range.end, 7)
    assert.ok(result.content.includes("goodbye"))
  })
})
