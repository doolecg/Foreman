import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireTestLock, releaseTestLock, testLockPath, withTestLock } from './test-lock'
import * as tickets from './tickets'

// removeStale stays real unless a test swaps it for one that fails.
vi.mock('./tickets', async (importOriginal) => {
  const real = await importOriginal<typeof import('./tickets')>()
  return { ...real, removeStale: vi.fn(real.removeStale) }
})

let folder: string
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'foreman-testlock-'))
  vi.mocked(tickets.removeStale).mockImplementation((await vi.importActual<typeof import('./tickets')>('./tickets')).removeStale)
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const makeStale = () => {
  mkdirSync(tickets.ticketsDir(folder), { recursive: true })
  writeFileSync(testLockPath(folder), 'someone-else')
  const old = new Date(Date.now() - 60 * 60_000)
  utimesSync(testLockPath(folder), old, old)
}

describe('test lock', () => {
  it('makes a second acquire wait, then succeed after release', async () => {
    const first = await acquireTestLock(folder)
    let got = false
    const second = acquireTestLock(folder, { pollMs: 10 }).then((t) => {
      got = true
      return t
    })
    await pause(80)
    expect(got).toBe(false)
    releaseTestLock(folder, first)
    const token = await second
    expect(got).toBe(true)
    releaseTestLock(folder, token)
    expect(existsSync(testLockPath(folder))).toBe(false)
  })

  it('gives up after the wait time', async () => {
    await acquireTestLock(folder)
    await expect(acquireTestLock(folder, { waitMs: 50, pollMs: 10 })).rejects.toThrow(/test lock/)
  })

  it('clears a stale lock', async () => {
    makeStale()
    await acquireTestLock(folder, { staleMs: 1000, waitMs: 500, pollMs: 10 })
    expect(existsSync(testLockPath(folder))).toBe(true)
  })

  it('ends in a timeout, not a hang, when a stale lock cannot be removed', async () => {
    makeStale()
    vi.mocked(tickets.removeStale).mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    await expect(acquireTestLock(folder, { staleMs: 1000, waitMs: 100, pollMs: 10 })).rejects.toThrow(/test lock/)
    // The same when removal is silently ignored instead of throwing.
    vi.mocked(tickets.removeStale).mockImplementation(() => {})
    await expect(acquireTestLock(folder, { staleMs: 1000, waitMs: 100, pollMs: 10 })).rejects.toThrow(/test lock/)
  })

  it('does not delete a lock that was taken over after going stale', async () => {
    const mine = await acquireTestLock(folder)
    writeFileSync(testLockPath(folder), 'the-new-holder')
    releaseTestLock(folder, mine)
    expect(readFileSync(testLockPath(folder), 'utf8')).toBe('the-new-holder')
  })

  it('runs two jobs one after the other and releases after a failure', async () => {
    const log: string[] = []
    const job = (name: string, fail = false) =>
      withTestLock(
        folder,
        async () => {
          log.push(`${name} start`)
          await pause(40)
          log.push(`${name} end`)
          if (fail) throw new Error('boom')
        },
        { pollMs: 5 },
      )
    await Promise.allSettled([job('a', true), job('b')])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end'])
    expect(existsSync(testLockPath(folder))).toBe(false)
  })
})
