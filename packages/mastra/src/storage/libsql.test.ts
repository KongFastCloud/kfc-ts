import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("@mastra/libsql", () => {
  return {
    LibSQLStore: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
      url: config.url,
      _isMockStore: true,
    })),
  };
});

import { mkdirSync } from "node:fs";
import { createLocalLibSQLStorage } from "./libsql";

describe("createLocalLibSQLStorage", () => {
  it("creates a LibSQLStore with the given file URL", () => {
    const store = createLocalLibSQLStorage({
      url: "file:./data/test.db",
    });

    expect(store).toBeDefined();
    const mock = store as unknown as Record<string, unknown>;
    expect(mock.url).toBe("file:./data/test.db");
  });

  it("accepts absolute file paths", () => {
    const store = createLocalLibSQLStorage({
      url: "file:/tmp/mastra/memory.db",
    });

    const mock = store as unknown as Record<string, unknown>;
    expect(mock.url).toBe("file:/tmp/mastra/memory.db");
  });

  it("ensures the parent directory exists", () => {
    createLocalLibSQLStorage({
      url: "file:./data/nested/test.db",
    });

    expect(mkdirSync).toHaveBeenCalled();
    const call = vi.mocked(mkdirSync).mock.calls.at(-1);
    expect(call).toBeDefined();
    // The path should end with the parent directory of the db file
    const dirPath = call![0] as string;
    expect(dirPath).toContain("nested");
    expect(call![1]).toEqual({ recursive: true });
  });

  it("throws if URL does not start with file:", () => {
    expect(() =>
      createLocalLibSQLStorage({
        url: "libsql://my-db.turso.io",
      }),
    ).toThrow('Local LibSQL storage URL must start with "file:"');
  });

  it("throws for https URLs", () => {
    expect(() =>
      createLocalLibSQLStorage({
        url: "https://my-db.turso.io",
      }),
    ).toThrow('Local LibSQL storage URL must start with "file:"');
  });

  it("throws for memory URLs", () => {
    expect(() =>
      createLocalLibSQLStorage({
        url: ":memory:",
      }),
    ).toThrow('Local LibSQL storage URL must start with "file:"');
  });
});
