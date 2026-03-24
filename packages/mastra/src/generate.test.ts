import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateText } from "ai";
import { generate } from "./generate";

vi.mock("ai", () => ({
  generateText: vi.fn(
    async ({ model, messages, system }: Record<string, unknown>) => ({
      model,
      messages,
      system,
      text: "Generated response",
    })
  ),
}));

describe("generate", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockClear();
  });

  it("calls generateText with gateway model and messages", async () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    await generate({ messages });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ messages }),
    );
  });

  it("uses default model when none specified", async () => {
    await generate({ messages: [{ role: "user" as const, content: "Hi" }] });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.model.modelId).toBe("anthropic/claude-sonnet-4-6");
  });

  it("uses custom model when specified", async () => {
    await generate({
      messages: [{ role: "user" as const, content: "Hi" }],
      model: "openai/gpt-4o",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.model.modelId).toBe("openai/gpt-4o");
  });

  it("passes system prompt when provided", async () => {
    await generate({
      messages: [{ role: "user" as const, content: "Hi" }],
      system: "You are a pirate",
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ system: "You are a pirate" }),
    );
  });

  it("returns an object with text property", async () => {
    const result = await generate({
      messages: [{ role: "user" as const, content: "Hi" }],
    });

    expect(result).toEqual({ text: "Generated response" });
  });
});
