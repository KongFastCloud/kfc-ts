/**
 * ABOUTME: Verification agent step.
 * Runs a verification agent that checks task implementation,
 * parses structured JSON response, and returns ReportResult.
 * Verification failure is treated as CheckFailure (retryable).
 */

import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { CheckFailure, FatalError } from "./errors.js"
import { Engine } from "./engine.js"

export interface ReportResult {
  readonly success: boolean
  readonly report: string
  readonly reportPath?: string
}

export interface ReportOptions {
  /** Directory to store report files. Defaults to ".blueprints/reports". */
  readonly reportsDir?: string
}

const DEFAULT_REPORTS_DIR = ".blueprints/reports"

const buildPrompt = (task: string, mode: "browser" | "basic", reportsDir: string): string => {
  const base = `You are a verification agent. Your job is to verify that the following task was correctly implemented:

${task}

Steps:
1. Read the codebase to understand what was implemented.
2. Verify the implementation actually works by running it / testing it.`

  const browserInstructions = mode === "browser"
    ? `
3. If this task involves a web UI, use agent-browser to start the dev server, navigate the app, and record a video demonstrating the feature works. Save the video to the ${reportsDir}/ directory.
4. If this task does NOT involve a web UI, verify via terminal commands instead.`
    : `
3. Verify via terminal commands — run the feature, check its output, confirm it behaves as expected.`

  return `${base}${browserInstructions}

Save a report file to the ${reportsDir}/ directory with details of your verification.

At the end of your response, output EXACTLY one JSON block in this format:
\`\`\`json
{"success": true or false, "report": "summary of what you verified", "reportPath": "path to the report file you saved"}
\`\`\`

If the feature is NOT correctly implemented, set success to false and explain what's wrong in the report.`
}

const parseReportResult = (response: string): ReportResult => {
  const jsonMatch = response.match(/```json\s*\n?([\s\S]*?)\n?\s*```/)
  if (!jsonMatch) {
    return { success: false, report: "Agent did not return a structured report." }
  }

  const jsonPayload = jsonMatch[1]
  if (!jsonPayload) {
    return { success: false, report: "Agent returned an empty JSON code block." }
  }

  try {
    const parsed = JSON.parse(jsonPayload)
    return {
      success: Boolean(parsed.success),
      report: String(parsed.report ?? ""),
      reportPath: parsed.reportPath ? String(parsed.reportPath) : undefined,
    }
  } catch {
    return { success: false, report: "Failed to parse agent report JSON." }
  }
}

export const report = (
  task: string,
  workspace: string,
  mode: "browser" | "basic",
  options?: ReportOptions,
): Effect.Effect<ReportResult, CheckFailure | FatalError, Engine> =>
  Effect.gen(function* () {
    const engine = yield* Engine

    const reportsDir = options?.reportsDir ?? DEFAULT_REPORTS_DIR
    const resolvedDir = path.join(workspace, reportsDir)
    fs.mkdirSync(resolvedDir, { recursive: true })

    yield* Effect.logInfo(`Running verification (${mode})...`)
    const prompt = buildPrompt(task, mode, reportsDir)
    const result = yield* engine.execute(prompt, workspace)

    const reportResult = parseReportResult(result.response)

    if (!reportResult.success) {
      yield* Effect.logWarning(`Verification failed: ${reportResult.report}`)
      return yield* Effect.fail(
        new CheckFailure({
          command: "report",
          stderr: reportResult.report,
          exitCode: 1,
        }),
      )
    }

    yield* Effect.logInfo(`Verification passed.`)
    if (reportResult.reportPath) {
      yield* Effect.logInfo(`Report: ${reportResult.reportPath}`)
    }

    return reportResult
  }).pipe(Effect.withLogSpan("verification"))
