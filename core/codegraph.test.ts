import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrewIndexes, globalCodegraph } from './codegraph'

describe('CrewIndexes', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('reports an unindexed folder, then indexes it on request', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foreman-cg-'))
    writeFileSync(join(dir, 'a.ts'), 'export function greet(n: string) { return helper(n) }\nfunction helper(n: string) { return n }\n')
    const idx = new CrewIndexes()

    expect(idx.status(dir)).toMatchObject({ initialized: false, files: 0 })

    const after = await idx.index(dir)
    expect(after).toMatchObject({ initialized: true, indexing: false, files: 1 })
    expect(after.symbols).toBeGreaterThanOrEqual(2)

    // Re-indexing an existing index syncs instead of starting over.
    writeFileSync(join(dir, 'b.ts'), 'export const b = 1\n')
    expect((await idx.index(dir)).files).toBe(2)
  }, 60_000)
})

describe('globalCodegraph', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('finds the SDK under the npm global root', async () => {
    const get = globalCodegraph(async () => ({ code: 0, stdout: '/g/node_modules\n', stderr: '' }), () => true)
    await tick()
    expect(get()).toBe(join('/g/node_modules', '@colbymchenry', 'codegraph'))
  })

  it('picks up an install made later without asking npm again', async () => {
    let installed = false
    let runs = 0
    const get = globalCodegraph(async () => (runs++, { code: 0, stdout: '/g/node_modules', stderr: '' }), () => installed)
    await tick()
    expect(get()).toBeNull()
    installed = true
    expect(get()).toBe(join('/g/node_modules', '@colbymchenry', 'codegraph'))
    expect(runs).toBe(1)
  })

  it('asks npm again at most every 10 seconds while it has no answer', async () => {
    let t = 0
    let runs = 0
    const get = globalCodegraph(async () => (runs++, { code: 1, stdout: '', stderr: 'npm missing' }), () => true, () => t)
    await tick()
    get()
    get()
    expect(runs).toBe(1)
    t = 10_000
    get()
    expect(runs).toBe(2)
  })

  it('says CodeGraph is not installed when no install was found', async () => {
    vi.resetModules()
    const fresh = await import('./codegraph')
    const status = new fresh.CrewIndexes(() => null).status(tmpdir())
    expect(status.error).toBe(fresh.CODEGRAPH_MISSING)
  })
})

describe('indexing off the main thread', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('does not block the event loop while another process holds the database write lock, and reports the lock', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foreman-cg-lock-'))
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
    const idx = new CrewIndexes()
    await idx.index(dir)
    const { DatabaseSync } = await import('node:sqlite')
    const holder = new DatabaseSync(join(dir, '.codegraph', 'codegraph.db'))
    holder.exec('BEGIN IMMEDIATE')
    writeFileSync(join(dir, 'b.ts'), 'export const b = 1\n')
    let worst = 0
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      worst = Math.max(worst, now - last - 50)
      last = now
    }, 50)
    try {
      await expect(idx.index(dir)).rejects.toThrow(/locked/i)
    } finally {
      clearInterval(timer)
      holder.exec('ROLLBACK')
      holder.close()
    }
    expect(worst).toBeLessThan(1000)
    expect(idx.status(dir).indexing).toBe(false)
  }, 60_000)

  it('stops a run that takes too long', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foreman-cg-slow-'))
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
    await expect(new CrewIndexes().index(dir, 1)).rejects.toThrow(/stopped/)
    expect(new CrewIndexes().status(dir).indexing).toBe(false)
  }, 60_000)
})
