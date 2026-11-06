import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { removeStale, ticketsDir } from './tickets'

// One build or test run at a time across every worker process in a project. Same file-lock approach as board.md,
// but async, because a build takes minutes and must not block the event loop while it waits.

export interface TestLockOptions {
  // How long to wait for the holder before giving up.
  waitMs?: number
  // A holder that died leaves the file behind; after this long it is cleared.
  staleMs?: number
  pollMs?: number
}

const WAIT_MS = 10 * 60_000
const STALE_MS = 30 * 60_000
const POLL_MS = 200

export function testLockPath(folder: string): string {
  return join(ticketsDir(folder), '.testlock')
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Resolves with this holder's token once it owns the lock. Pass the token to releaseTestLock, or use withTestLock.
export async function acquireTestLock(folder: string, opts: TestLockOptions = {}): Promise<string> {
  mkdirSync(ticketsDir(folder), { recursive: true })
  const lock = testLockPath(folder)
  const deadline = Date.now() + (opts.waitMs ?? WAIT_MS)
  const staleMs = opts.staleMs ?? STALE_MS
  const token = randomUUID()
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      try {
        writeSync(fd, token)
      } finally {
        closeSync(fd)
      }
      return token
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    try {
      if (Date.now() - statSync(lock).mtimeMs > staleMs) removeStale(lock)
    } catch {
      // Gone already, or it cannot be removed: either way fall through to the deadline and the pause, so this never spins.
    }
    if (Date.now() >= deadline) throw new Error('Another build or test run holds the test lock; try again later')
    await pause(opts.pollMs ?? POLL_MS)
  }
}

// Deletes the lock only if it is still this holder's: after a stale takeover the file belongs to someone else.
export function releaseTestLock(folder: string, token: string): void {
  const lock = testLockPath(folder)
  try {
    if (readFileSync(lock, 'utf8') !== token) return
  } catch {
    return
  }
  rmSync(lock, { force: true })
}

export async function withTestLock<T>(folder: string, fn: () => Promise<T> | T, opts?: TestLockOptions): Promise<T> {
  const token = await acquireTestLock(folder, opts)
  try {
    return await fn()
  } finally {
    releaseTestLock(folder, token)
  }
}
