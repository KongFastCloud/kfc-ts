import type { WatchTask } from "../beadsAdapter.js"

export interface AggregateTotals {
  readonly totalMs: number
  readonly count: number
}

const EMPTY: AggregateTotals = { totalMs: 0, count: 0 }

/**
 * Return start-of-day (midnight local) for the given date.
 */
function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

/**
 * Return start of the ISO week (Monday 00:00 local) containing the given date.
 */
function startOfWeek(d: Date): Date {
  const r = startOfDay(d)
  // getDay(): 0=Sun,1=Mon,...,6=Sat  → offset to Monday
  const day = r.getDay()
  const diff = (day + 6) % 7 // Mon=0, Tue=1, ..., Sun=6
  r.setDate(r.getDate() - diff)
  return r
}

/**
 * Try to parse an ISO-8601 string into a valid Date.
 * Returns undefined for missing, empty, or unparseable values.
 */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

/**
 * Core aggregation: filter done tasks whose finishedAt falls within
 * [windowStart, windowEnd) and sum their durations.
 */
function aggregate(
  tasks: readonly WatchTask[],
  windowStart: Date,
  windowEnd: Date,
): AggregateTotals {
  let totalMs = 0
  let count = 0

  for (const task of tasks) {
    if (task.status !== "done") continue

    const started = parseDate(task.startedAt)
    const finished = parseDate(task.finishedAt)
    if (!started || !finished) continue

    const finishedMs = finished.getTime()
    if (finishedMs < windowStart.getTime() || finishedMs >= windowEnd.getTime()) continue

    totalMs += finishedMs - started.getTime()
    count++
  }

  if (count === 0) return EMPTY
  return { totalMs, count }
}

/**
 * Sum durations of done tasks whose finishedAt falls on the same calendar day
 * (local time) as referenceDate.
 */
export function computeDayTotal(
  tasks: readonly WatchTask[],
  referenceDate: Date,
): AggregateTotals {
  const dayStart = startOfDay(referenceDate)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return aggregate(tasks, dayStart, dayEnd)
}

/**
 * Sum durations of done tasks whose finishedAt falls within the ISO week
 * (Monday 00:00 through Sunday 23:59:59.999, local time) containing referenceDate.
 */
export function computeWeekTotal(
  tasks: readonly WatchTask[],
  referenceDate: Date,
): AggregateTotals {
  const weekStart = startOfWeek(referenceDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return aggregate(tasks, weekStart, weekEnd)
}
