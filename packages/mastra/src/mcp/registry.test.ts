import { describe, expect, it, vi } from "vitest";
import { validateEnv, buildMCPClient, MCPConfigError } from "./registry.ts";
import type { MCPServerRegistration } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal registration that requires FOO and optionally uses BAR. */
const fakeRegistration: MCPServerRegistration = {
  name: "fake",
  description: "A fake MCP server for testing.",
  env: [
    { name: "FOO", required: true, description: "Required var." },
    { name: "BAR", required: false, description: "Optional var." },
  ],
  createDefinition: (env) => ({
    command: "echo",
    args: [env.FOO!],
    env: { FOO: env.FOO! },
  }),
};

// ---------------------------------------------------------------------------
// validateEnv
// ---------------------------------------------------------------------------

describe("validateEnv", () => {
  it("passes when all required env vars are present", () => {
    expect(() =>
      validateEnv(fakeRegistration, { FOO: "value" }),
    ).not.toThrow();
  });

  it("passes when optional vars are absent", () => {
    expect(() =>
      validateEnv(fakeRegistration, { FOO: "value" }),
    ).not.toThrow();
  });

  it("throws MCPConfigError when a required var is missing", () => {
    expect(() => validateEnv(fakeRegistration, {})).toThrow(MCPConfigError);
  });

  it("includes the server name and missing vars in the error", () => {
    try {
      validateEnv(fakeRegistration, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPConfigError);
      const e = err as MCPConfigError;
      expect(e.server).toBe("fake");
      expect(e.missing).toEqual(["FOO"]);
      expect(e.message).toContain("FOO");
    }
  });

  it("treats empty string as missing", () => {
    expect(() => validateEnv(fakeRegistration, { FOO: "" })).toThrow(
      MCPConfigError,
    );
  });
});

// ---------------------------------------------------------------------------
// buildMCPClient
// ---------------------------------------------------------------------------

vi.mock("@mastra/mcp", () => ({
  MCPClient: vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    _opts: opts,
    _isMock: true,
  })),
}));

describe("buildMCPClient", () => {
  it("creates an MCPClient with resolved server definitions", () => {
    const client = buildMCPClient([fakeRegistration], {
      env: { FOO: "hello" },
    });

    // The mock MCPClient stores its options so we can inspect them.
    const opts = (client as unknown as { _opts: Record<string, unknown> })
      ._opts;
    expect(opts.servers).toBeDefined();
    expect(
      (opts.servers as Record<string, unknown>).fake,
    ).toEqual({
      command: "echo",
      args: ["hello"],
      env: { FOO: "hello" },
    });
  });

  it("throws before constructing the client when env is invalid", () => {
    expect(() =>
      buildMCPClient([fakeRegistration], { env: {} }),
    ).toThrow(MCPConfigError);
  });

  it("forwards the timeout option", () => {
    const client = buildMCPClient([fakeRegistration], {
      env: { FOO: "x" },
      timeout: 5000,
    });

    const opts = (client as unknown as { _opts: Record<string, unknown> })
      ._opts;
    expect(opts.timeout).toBe(5000);
  });

  it("supports multiple registrations", () => {
    const second: MCPServerRegistration = {
      name: "other",
      description: "Another server.",
      env: [],
      createDefinition: () => ({ command: "true" }),
    };

    const client = buildMCPClient([fakeRegistration, second], {
      env: { FOO: "x" },
    });

    const opts = (client as unknown as { _opts: Record<string, unknown> })
      ._opts;
    const servers = opts.servers as Record<string, unknown>;
    expect(Object.keys(servers)).toEqual(["fake", "other"]);
  });
});
