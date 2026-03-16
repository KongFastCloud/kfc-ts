import { describe, expect, it } from "vitest";
import { chat, gateway, mastra } from "./index";

describe("package exports", () => {
  it("exports a Mastra instance", () => {
    expect(mastra).toBeDefined();
  });

  it("exports the gateway provider", () => {
    expect(gateway).toBeDefined();
    expect(typeof gateway).toBe("function");
  });

  it("exports the chat function", () => {
    expect(chat).toBeDefined();
    expect(typeof chat).toBe("function");
  });
});
