import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildBackgroundArgs,
  getRalpheDir,
  getRunLogPath,
} from "../src/background.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralphe-background-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("background helpers", () => {
  test("buildBackgroundArgs removes background flags", () => {
    expect(
      buildBackgroundArgs([
        "/usr/bin/bun",
        "/repo/apps/ralphe/cli.ts",
        "run",
        "--background",
        "--file",
        "PRD.md",
      ]),
    ).toEqual([
      "/usr/bin/bun",
      "/repo/apps/ralphe/cli.ts",
      "run",
      "--file",
      "PRD.md",
    ])

    expect(
      buildBackgroundArgs([
        "/usr/bin/bun",
        "/repo/apps/ralphe/cli.ts",
        "run",
        "-b",
        "fix tests",
      ]),
    ).toEqual([
      "/usr/bin/bun",
      "/repo/apps/ralphe/cli.ts",
      "run",
      "fix tests",
    ])
  })

  test("returns default ralphe paths", () => {
    expect(getRalpheDir(tmpDir)).toBe(path.join(tmpDir, ".ralphe"))
    expect(getRunLogPath(tmpDir)).toBe(path.join(tmpDir, ".ralphe", "run.log"))
  })
})
