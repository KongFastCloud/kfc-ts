import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamText } from "ai";
import { chat } from "./chat";

vi.mock("ai", () => ({
  streamText: vi.fn(
    ({ model, messages, system }: Record<string, unknown>) => ({
      model,
      messages,
      system,
      textStream: (function* () {
        yield "Hello";
        yield " world";
      })(),
      toDataStreamResponse() {
        return new Response("mock-stream", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    })
  ),
}));

describe("chat", () => {
  beforeEach(() => {
    vi.mocked(streamText).mockClear();
  });

  it("calls streamText with gateway model and messages", () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    chat({ messages });

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
      })
    );
  });

  it("uses default model when none specified", () => {
    chat({ messages: [{ role: "user" as const, content: "Hi" }] });

    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.model.modelId).toBe("anthropic/claude-sonnet-4-6");
  });

  it("uses custom model when specified", () => {
    chat({
      messages: [{ role: "user" as const, content: "Hi" }],
      model: "openai/gpt-4o",
    });

    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.model.modelId).toBe("openai/gpt-4o");
  });

  it("passes system prompt when provided", () => {
    chat({
      messages: [{ role: "user" as const, content: "Hi" }],
      system: "You are a pirate",
    });

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are a pirate",
      })
    );
  });

  it("returns a streamable result", () => {
    const result = chat({
      messages: [{ role: "user" as const, content: "Hi" }],
    });

    expect(result).toBeDefined();
    expect(result.textStream).toBeDefined();
  });
});
