import { Effect, Layer, Logger, HashMap, List } from "effect"
import type { LogSpan } from "effect/LogSpan"

// -- helpers --

const LOG_DIR = ".ralphe/logs"

const logFileName = (date: Date): string => {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `ralphe-${yyyy}-${mm}-${dd}.log`
}

const ensureLogDir = Effect.sync(() => {
  require("node:fs").mkdirSync(LOG_DIR, { recursive: true })
})

const spansToRecord = (spans: List.List<LogSpan>): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const span of spans) {
    result[span.label] = Date.now() - span.startTime
  }
  return result
}

const annotationsToRecord = (annotations: HashMap.HashMap<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of annotations) {
    result[key] = value
  }
  return result
}

const formatMessage = (message: unknown): string => {
  if (typeof message === "string") return message
  if (Array.isArray(message)) return message.map(formatMessage).join(" ")
  return String(message)
}

// -- file logger --

const makeFileLogger = (): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, annotations, spans, date }) => {
    const entry = JSON.stringify({
      timestamp: date.toISOString(),
      level: logLevel.label,
      message: formatMessage(message),
      annotations: annotationsToRecord(annotations),
      spans: spansToRecord(spans),
    })

    const filePath = `${LOG_DIR}/${logFileName(date)}`

    // Loggers must be synchronous — use node:fs for append
    const fs = require("node:fs")
    fs.appendFileSync(filePath, entry + "\n")
  })

// -- stderr logger --

const stderrLogger: Logger.Logger<unknown, void> =
  Logger.logfmtLogger.pipe(Logger.withConsoleError)

// -- composed logger --

const makeAppLogger = (): Logger.Logger<unknown, void> => {
  const fileLogger = makeFileLogger()
  return Logger.zip(stderrLogger, fileLogger).pipe(
    Logger.map(() => void 0),
  )
}

// -- exported layers --

export const AppLoggerLayer: Layer.Layer<never> = Layer.merge(
  Logger.replace(Logger.defaultLogger, makeAppLogger()),
  Layer.effectDiscard(ensureLogDir),
)

/**
 * Logger layer for full-screen TUI commands.
 * Writes JSON lines to .ralphe/logs/ but suppresses all stderr output,
 * preventing logfmt noise from corrupting the terminal display.
 */
export const TuiLoggerLayer: Layer.Layer<never> = Layer.merge(
  Logger.replace(Logger.defaultLogger, makeFileLogger()),
  Layer.effectDiscard(ensureLogDir),
)
