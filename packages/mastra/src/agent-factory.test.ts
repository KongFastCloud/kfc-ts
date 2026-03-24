import { describe, expect, it, vi } from "vitest";

vi.mock("@mastra/core/agent", () => {
  return {
    Agent: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
      name: config.name,
      instructions: config.instructions,
      model: config.model,
      _isMockAgent: true,
    })),
  };
});

import { createAgent } from "./agent-factory";

describe("createAgent", () => {
  it("creates an agent with the provided name and instructions", () => {
    const agent = createAgent({
      name: "test-agent",
      instructions: "You are a test agent.",
    });

    expect(agent).toBeDefined();
    // The mock returns the config back, so we can inspect it
    expect((agent as unknown as Record<string, unknown>).name).toBe("test-agent");
    expect((agent as unknown as Record<string, unknown>).instructions).toBe(
      "You are a test agent.",
    );
  });

  it("uses default model when none specified", () => {
    const agent = createAgent({
      name: "test-agent",
      instructions: "Test",
    });

    const model = (agent as unknown as Record<string, unknown>).model as {
      modelId: string;
    };
    expect(model.modelId).toBe("anthropic/claude-sonnet-4-6");
  });

  it("uses custom model when specified", () => {
    const agent = createAgent({
      name: "test-agent",
      instructions: "Test",
      model: "openai/gpt-4o",
    });

    const model = (agent as unknown as Record<string, unknown>).model as {
      modelId: string;
    };
    expect(model.modelId).toBe("openai/gpt-4o");
  });
});
