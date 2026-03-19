/**
 * ABOUTME: Tests for timing metadata passthrough in beadsAdapter.
 * Verifies that startedAt/finishedAt from bd JSON metadata.ralphe
 * are correctly mapped to WatchTask fields, whether the ralphe
 * payload is returned as a structured object or serialized JSON string.
 */

import { describe, it, expect } from "bun:test"
import { parseBdTaskList } from "../src/beadsAdapter.js"

describe("parseBdTaskList timing metadata", () => {
  it("extracts startedAt and finishedAt from metadata.ralphe", () => {
    const json = JSON.stringify([
      {
        id: "task-1",
        title: "Test task",
        status: "in_progress",
        metadata: {
          ralphe: {
            engine: "claude",
            workerId: "w1",
            startedAt: "2025-01-01T00:00:00.000Z",
          },
        },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBe("2025-01-01T00:00:00.000Z")
    expect(tasks[0]!.finishedAt).toBeUndefined()
  })

  it("extracts both timestamps for completed tasks", () => {
    const json = JSON.stringify([
      {
        id: "task-2",
        title: "Done task",
        status: "closed",
        metadata: {
          ralphe: {
            engine: "claude",
            workerId: "w1",
            startedAt: "2025-01-01T00:00:00.000Z",
            finishedAt: "2025-01-01T00:05:00.000Z",
          },
        },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBe("2025-01-01T00:00:00.000Z")
    expect(tasks[0]!.finishedAt).toBe("2025-01-01T00:05:00.000Z")
  })

  it("handles missing metadata gracefully", () => {
    const json = JSON.stringify([
      {
        id: "task-3",
        title: "No metadata",
        status: "open",
        labels: ["ready"],
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBeUndefined()
    expect(tasks[0]!.finishedAt).toBeUndefined()
  })

  it("handles metadata without ralphe namespace", () => {
    const json = JSON.stringify([
      {
        id: "task-4",
        title: "Other metadata",
        status: "open",
        metadata: { other: { foo: "bar" } },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBeUndefined()
    expect(tasks[0]!.finishedAt).toBeUndefined()
  })

  // -- Serialized JSON string tests ------------------------------------------

  it("extracts startedAt when ralphe metadata is a serialized JSON string", () => {
    const json = JSON.stringify([
      {
        id: "task-5",
        title: "Serialized active",
        status: "in_progress",
        metadata: {
          ralphe: JSON.stringify({
            engine: "claude",
            workerId: "w1",
            startedAt: "2025-06-01T12:00:00.000Z",
          }),
        },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBe("2025-06-01T12:00:00.000Z")
    expect(tasks[0]!.finishedAt).toBeUndefined()
  })

  it("extracts startedAt and finishedAt when ralphe metadata is a serialized JSON string", () => {
    const json = JSON.stringify([
      {
        id: "task-6",
        title: "Serialized done",
        status: "closed",
        metadata: {
          ralphe: JSON.stringify({
            engine: "claude",
            workerId: "w1",
            startedAt: "2025-06-01T12:00:00.000Z",
            finishedAt: "2025-06-01T12:10:00.000Z",
          }),
        },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBe("2025-06-01T12:00:00.000Z")
    expect(tasks[0]!.finishedAt).toBe("2025-06-01T12:10:00.000Z")
  })

  it("handles invalid serialized ralphe metadata without crashing", () => {
    const json = JSON.stringify([
      {
        id: "task-7",
        title: "Bad serialized",
        status: "in_progress",
        metadata: {
          ralphe: "not valid json {{{",
        },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBeUndefined()
    expect(tasks[0]!.finishedAt).toBeUndefined()
  })

  it("handles serialized ralphe metadata that parses to a non-object", () => {
    const json = JSON.stringify([
      {
        id: "task-8",
        title: "Non-object serialized",
        status: "in_progress",
        metadata: {
          ralphe: JSON.stringify(42),
        },
      },
    ])

    const tasks = parseBdTaskList(json)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.startedAt).toBeUndefined()
    expect(tasks[0]!.finishedAt).toBeUndefined()
  })
})
