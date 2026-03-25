/**
 * Minimal in-memory state adapter for local development.
 *
 * Provides per-thread locking so that concurrent requests for the
 * same thread are serialised. This prevents interleaved processing
 * when Google Chat retries or users send rapid messages.
 *
 * Not durable — all state is lost on restart. Suitable for single-
 * instance local development; replace with a durable adapter when
 * scaling beyond one process.
 */

type Release = () => void

const locks = new Map<string, Promise<void>>()

/**
 * Acquire an exclusive lock for `threadId`.
 *
 * Returns a release function that MUST be called when processing
 * is complete (use try/finally).
 *
 * ```ts
 * const release = await acquireThreadLock(threadId)
 * try {
 *   // process message
 * } finally {
 *   release()
 * }
 * ```
 */
export const acquireThreadLock = async (threadId: string): Promise<Release> => {
  // Wait for any existing lock on this thread to clear
  while (locks.has(threadId)) {
    await locks.get(threadId)
  }

  let release!: Release
  const gate = new Promise<void>((resolve) => {
    release = () => {
      locks.delete(threadId)
      resolve()
    }
  })

  locks.set(threadId, gate)
  return release
}
