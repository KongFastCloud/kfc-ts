/**
 * ABOUTME: Epic-specific bootstrap adapter.
 * Delegates to blueprints bootstrap primitives for reusable lockfile-aware
 * install behavior. Re-exports types for backward compatibility.
 */

export type { BootstrapPackageManager } from "@workspace/blueprints"
export { detectPackageManager as detectBootstrapPackageManager, bootstrapCommandFor } from "@workspace/blueprints"

import { bootstrapInstall } from "@workspace/blueprints"

/**
 * Bootstrap an epic worktree by running lockfile-aware dependency installation.
 * This is a thin adapter that delegates to the blueprints bootstrap primitive.
 */
export const bootstrapEpicWorktree = bootstrapInstall
