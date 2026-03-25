/**
 * Regression guard: ensure the old "repochat" product name does not
 * resurface in active code paths, package metadata, or documentation.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const seerRoot = path.resolve(import.meta.dirname, "..")
const srcDir = path.resolve(seerRoot, "src")

/** Recursively collect every .ts file under a directory. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full))
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full)
    }
  }
  return results
}

const thisFile = path.resolve(import.meta.dirname, "product-name.test.ts")

describe("product name consistency", () => {
  it("source files do not contain stale 'repochat' references", () => {
    const files = collectTsFiles(srcDir).filter((f) => f !== thisFile)
    const violations: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8")
      if (/repochat/i.test(content)) {
        violations.push(path.relative(seerRoot, file))
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found stale "repochat" references in:\n  ${violations.join("\n  ")}`,
    )
  })

  it("package.json name field is 'seer'", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(seerRoot, "package.json"), "utf-8"),
    )
    assert.equal(pkg.name, "seer", "package.json name should be 'seer'")
  })

  it("README.md does not contain stale 'repochat' references", () => {
    const readmePath = path.join(seerRoot, "README.md")
    if (!fs.existsSync(readmePath)) return // no README to check
    const content = fs.readFileSync(readmePath, "utf-8")
    assert.ok(
      !/repochat/i.test(content),
      "README.md still contains a 'repochat' reference",
    )
  })
})
