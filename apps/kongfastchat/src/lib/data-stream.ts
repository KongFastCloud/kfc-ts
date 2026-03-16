/**
 * Parse a single line from an AI SDK data stream and invoke onToken for text chunks.
 * The AI SDK data stream format sends lines like: 0:"token text"\n
 */
export function parseDataStreamLine(
  line: string,
  onToken: (token: string) => void,
) {
  const match = line.match(/^0:"(.*)"$/)
  if (match) {
    const text = JSON.parse(`"${match[1]}"`) as string
    onToken(text)
  }
}

/**
 * Read an AI SDK data stream body and invoke onToken for each text chunk.
 */
export async function readDataStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      parseDataStreamLine(line, onToken)
    }
  }

  if (buffer) {
    parseDataStreamLine(buffer, onToken)
  }
}
