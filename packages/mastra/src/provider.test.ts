import { describe, expect, it } from "vitest";
import { gateway } from "./provider";

describe("gateway provider", () => {
  it("creates a language model from a string ID", () => {
    const model = gateway("openai/gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("openai/gpt-4o");
  });

  it("creates models for different providers", () => {
    const claude = gateway("anthropic/claude-sonnet-4-6");
    const gpt = gateway("openai/gpt-4o");

    expect(claude.modelId).toBe("anthropic/claude-sonnet-4-6");
    expect(gpt.modelId).toBe("openai/gpt-4o");
  });
});
