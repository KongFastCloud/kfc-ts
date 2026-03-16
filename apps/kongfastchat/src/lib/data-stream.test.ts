import { describe, expect, it, vi } from "vitest"
import { parseDataStreamLine, readDataStream } from "./data-stream"

describe("parseDataStreamLine", () => {
  it("extracts text from a valid data stream line", () => {
    const onToken = vi.fn()
    parseDataStreamLine('0:"Hello"', onToken)
    expect(onToken).toHaveBeenCalledWith("Hello")
  })

  it("handles escaped characters in the token", () => {
    const onToken = vi.fn()
    parseDataStreamLine('0:"Hello\\nWorld"', onToken)
    expect(onToken).toHaveBeenCalledWith("Hello\nWorld")
  })

  it("handles unicode escape sequences", () => {
    const onToken = vi.fn()
    parseDataStreamLine('0:"caf\\u00e9"', onToken)
    expect(onToken).toHaveBeenCalledWith("café")
  })

  it("ignores non-text data stream lines", () => {
    const onToken = vi.fn()
    // Lines starting with other prefixes (e.g. 2: for data, e: for error)
    parseDataStreamLine('2:["some-data"]', onToken)
    expect(onToken).not.toHaveBeenCalled()
  })

  it("ignores empty lines", () => {
    const onToken = vi.fn()
    parseDataStreamLine("", onToken)
    expect(onToken).not.toHaveBeenCalled()
  })

  it("handles empty string token", () => {
    const onToken = vi.fn()
    parseDataStreamLine('0:""', onToken)
    expect(onToken).toHaveBeenCalledWith("")
  })
})

describe("readDataStream", () => {
  function createStream(chunks: Array<string>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
  }

  it("reads tokens from a complete stream", async () => {
    const tokens: Array<string> = []
    const stream = createStream(['0:"Hello"\n', '0:" World"\n'])

    await readDataStream(stream, (token) => tokens.push(token))

    expect(tokens).toEqual(["Hello", " World"])
  })

  it("handles chunks split across line boundaries", async () => {
    const tokens: Array<string> = []
    // Split a line across two chunks
    const stream = createStream(['0:"Hel', 'lo"\n0:"World"\n'])

    await readDataStream(stream, (token) => tokens.push(token))

    expect(tokens).toEqual(["Hello", "World"])
  })

  it("handles trailing content without newline", async () => {
    const tokens: Array<string> = []
    const stream = createStream(['0:"Hello"'])

    await readDataStream(stream, (token) => tokens.push(token))

    expect(tokens).toEqual(["Hello"])
  })

  it("skips non-text lines in the stream", async () => {
    const tokens: Array<string> = []
    const stream = createStream([
      '0:"Hello"\n',
      '2:["data"]\n',
      '0:" World"\n',
    ])

    await readDataStream(stream, (token) => tokens.push(token))

    expect(tokens).toEqual(["Hello", " World"])
  })

  it("handles empty stream", async () => {
    const tokens: Array<string> = []
    const stream = createStream([])

    await readDataStream(stream, (token) => tokens.push(token))

    expect(tokens).toEqual([])
  })
})
