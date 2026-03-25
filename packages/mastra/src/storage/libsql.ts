/**
 * Reusable local LibSQL storage factory for Mastra memory.
 *
 * Provides a thin configuration contract around `@mastra/libsql`'s
 * `LibSQLStore` so that consumers get an explicit, local-file-backed
 * storage instance without duplicating setup boilerplate.
 *
 * The factory enforces that the storage URL is a local `file:` path,
 * keeping the scope intentionally local to a single workspace.
 *
 * @example
 * ```ts
 * import { createLocalLibSQLStorage } from "@workspace/mastra/storage/libsql"
 *
 * const storage = createLocalLibSQLStorage({
 *   url: "file:./data/memory.db",
 * })
 * ```
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LibSQLStore } from "@mastra/libsql";

/** Configuration contract for local LibSQL storage. */
export interface LocalLibSQLStorageConfig {
  /**
   * Local file URL for the LibSQL database.
   *
   * Must start with `file:` to ensure storage stays local.
   * Examples: `"file:./data/memory.db"`, `"file:/tmp/mastra.db"`
   *
   * The parent directory is created automatically if it does not exist.
   */
  readonly url: string;
}

/**
 * Ensure the parent directory for a `file:` URL exists.
 *
 * LibSQL's native driver requires the parent directory to exist before
 * opening a database file. This helper creates it recursively if needed.
 */
function ensureParentDir(fileUrl: string): void {
  // Strip the "file:" prefix to get the filesystem path.
  const filePath = resolve(fileUrl.slice("file:".length));
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * Create a local LibSQL-backed storage instance for Mastra.
 *
 * This is the reusable primitive for wiring durable local storage
 * into Mastra memory. The returned `LibSQLStore` can be passed
 * directly to Mastra's `Memory` constructor as the `storage` option.
 *
 * The parent directory for the database file is created automatically
 * if it does not already exist.
 *
 * @throws {Error} If `url` does not start with `file:`.
 */
export function createLocalLibSQLStorage(
  config: LocalLibSQLStorageConfig,
): LibSQLStore {
  if (!config.url.startsWith("file:")) {
    throw new Error(
      `Local LibSQL storage URL must start with "file:". Got: "${config.url}"`,
    );
  }

  ensureParentDir(config.url);

  return new LibSQLStore({
    url: config.url,
  });
}
