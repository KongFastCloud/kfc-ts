import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { FatalError } from "./errors.js"

const RALPHE_DIR = ".ralphe"
const RUN_LOG_FILE = "run.log"

export const getRalpheDir = (workDir = process.cwd()): string =>
  path.join(workDir, RALPHE_DIR)

export const getRunLogPath = (workDir = process.cwd()): string =>
  path.join(getRalpheDir(workDir), RUN_LOG_FILE)

export const buildBackgroundArgs = (argv = process.argv): string[] =>
  argv.filter((arg) => arg !== "--background" && arg !== "-b")

export const startBackgroundRun = (
  argv = process.argv,
  workDir = process.cwd(),
): Effect.Effect<{ readonly logPath: string; readonly pid: number }, FatalError> =>
  Effect.try({
    try: () => {
      const args = buildBackgroundArgs(argv)
      const logPath = getRunLogPath(workDir)

      fs.mkdirSync(getRalpheDir(workDir), { recursive: true })

      const logFd = fs.openSync(logPath, "w")

      try {
        const proc = Bun.spawn(args, {
          cwd: workDir,
          env: process.env,
          stdin: "ignore",
          stdout: logFd,
          stderr: logFd,
          detached: true,
        })

        proc.unref()

        return { logPath, pid: proc.pid }
      } finally {
        fs.closeSync(logFd)
      }
    },
    catch: (error) =>
      new FatalError({
        command: "run",
        message: `Failed to start background run: ${error}`,
      }),
  })

export const tailRunLog = (
  workDir = process.cwd(),
): Effect.Effect<void, FatalError> =>
  Effect.tryPromise({
    try: async () => {
      const logPath = getRunLogPath(workDir)

      if (!fs.existsSync(logPath)) {
        throw new Error(`No log file found at ${logPath}`)
      }

      const proc = Bun.spawn(["tail", "-f", logPath], {
        cwd: workDir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })

      await proc.exited
    },
    catch: (error) =>
      new FatalError({
        command: "log",
        message: `${error}`,
      }),
  })
