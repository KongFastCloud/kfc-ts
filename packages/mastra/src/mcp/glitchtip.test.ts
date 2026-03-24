import { describe, expect, it } from "vitest";
import { glitchtip } from "./glitchtip.ts";
import { validateEnv, MCPConfigError } from "./registry.ts";

describe("glitchtip registration", () => {
  // ── metadata ────────────────────────────────────────────────────

  it("has the expected server name", () => {
    expect(glitchtip.name).toBe("glitchtip");
  });

  it("declares GLITCHTIP_TOKEN as required", () => {
    const token = glitchtip.env.find((e) => e.name === "GLITCHTIP_TOKEN");
    expect(token).toBeDefined();
    expect(token!.required).toBe(true);
  });

  it("declares GLITCHTIP_ORGANIZATION as required", () => {
    const org = glitchtip.env.find(
      (e) => e.name === "GLITCHTIP_ORGANIZATION",
    );
    expect(org).toBeDefined();
    expect(org!.required).toBe(true);
  });

  it("declares GLITCHTIP_BASE_URL as optional", () => {
    const url = glitchtip.env.find((e) => e.name === "GLITCHTIP_BASE_URL");
    expect(url).toBeDefined();
    expect(url!.required).toBe(false);
  });

  it("does NOT declare GLITCHTIP_SESSION_ID", () => {
    const session = glitchtip.env.find(
      (e) => e.name === "GLITCHTIP_SESSION_ID",
    );
    expect(session).toBeUndefined();
  });

  // ── env validation ──────────────────────────────────────────────

  it("validates successfully with required vars present", () => {
    expect(() =>
      validateEnv(glitchtip, {
        GLITCHTIP_TOKEN: "tok_abc",
        GLITCHTIP_ORGANIZATION: "my-org",
      }),
    ).not.toThrow();
  });

  it("fails when GLITCHTIP_TOKEN is missing", () => {
    expect(() =>
      validateEnv(glitchtip, { GLITCHTIP_ORGANIZATION: "my-org" }),
    ).toThrow(MCPConfigError);
  });

  it("fails when GLITCHTIP_ORGANIZATION is missing", () => {
    expect(() =>
      validateEnv(glitchtip, { GLITCHTIP_TOKEN: "tok_abc" }),
    ).toThrow(MCPConfigError);
  });

  // ── definition factory ──────────────────────────────────────────

  it("produces an stdio definition using npx mcp-glitchtip", () => {
    const def = glitchtip.createDefinition({
      GLITCHTIP_TOKEN: "tok_abc",
      GLITCHTIP_ORGANIZATION: "my-org",
    });

    expect(def.command).toBe("npx");
    expect(def.args).toContain("mcp-glitchtip");
  });

  it("passes token and organization to the subprocess env", () => {
    const def = glitchtip.createDefinition({
      GLITCHTIP_TOKEN: "tok_abc",
      GLITCHTIP_ORGANIZATION: "my-org",
    });

    expect(def.env!.GLITCHTIP_TOKEN).toBe("tok_abc");
    expect(def.env!.GLITCHTIP_ORGANIZATION).toBe("my-org");
  });

  it("uses the default base URL when GLITCHTIP_BASE_URL is absent", () => {
    const def = glitchtip.createDefinition({
      GLITCHTIP_TOKEN: "tok_abc",
      GLITCHTIP_ORGANIZATION: "my-org",
    });

    expect(def.env!.GLITCHTIP_BASE_URL).toBe("https://app.glitchtip.com");
  });

  it("uses a custom base URL when GLITCHTIP_BASE_URL is provided", () => {
    const def = glitchtip.createDefinition({
      GLITCHTIP_TOKEN: "tok_abc",
      GLITCHTIP_ORGANIZATION: "my-org",
      GLITCHTIP_BASE_URL: "https://glitchtip.internal.dev",
    });

    expect(def.env!.GLITCHTIP_BASE_URL).toBe(
      "https://glitchtip.internal.dev",
    );
  });

  // ── read-only access ────────────────────────────────────────────

  it("describes itself as read-only", () => {
    expect(glitchtip.description.toLowerCase()).toContain("read-only");
  });

  // ── env contract coverage (.env.example alignment) ─────────────

  it("declares exactly three env vars matching the documented contract", () => {
    const names = glitchtip.env.map((e) => e.name).sort();
    expect(names).toEqual([
      "GLITCHTIP_BASE_URL",
      "GLITCHTIP_ORGANIZATION",
      "GLITCHTIP_TOKEN",
    ]);
  });

  it("does not forward unexpected env vars to the subprocess", () => {
    const def = glitchtip.createDefinition({
      GLITCHTIP_TOKEN: "tok_abc",
      GLITCHTIP_ORGANIZATION: "my-org",
      EXTRA_SECRET: "should-not-appear",
    });

    const envKeys = Object.keys(def.env!).sort();
    expect(envKeys).toEqual([
      "GLITCHTIP_BASE_URL",
      "GLITCHTIP_ORGANIZATION",
      "GLITCHTIP_TOKEN",
    ]);
    expect(def.env!).not.toHaveProperty("EXTRA_SECRET");
  });

  it("fails when both required vars are missing at once", () => {
    try {
      validateEnv(glitchtip, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MCPConfigError);
      const e = err as InstanceType<typeof MCPConfigError>;
      expect(e.missing).toContain("GLITCHTIP_TOKEN");
      expect(e.missing).toContain("GLITCHTIP_ORGANIZATION");
    }
  });

  it("treats empty-string token as missing", () => {
    expect(() =>
      validateEnv(glitchtip, {
        GLITCHTIP_TOKEN: "",
        GLITCHTIP_ORGANIZATION: "my-org",
      }),
    ).toThrow(MCPConfigError);
  });

  it("treats empty-string organization as missing", () => {
    expect(() =>
      validateEnv(glitchtip, {
        GLITCHTIP_TOKEN: "tok_abc",
        GLITCHTIP_ORGANIZATION: "",
      }),
    ).toThrow(MCPConfigError);
  });
});
