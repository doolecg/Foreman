import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteSnapshot, loadSnapshot, saveSnapshot, snapshotFile } from './graph-snapshot'
import { emptyGraph } from './orchestration-graph'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'foreman-graph-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('graph snapshot', () => {
  it('round-trips a finished graph and leaves no temp file', () => {
    const g = { ...emptyGraph('s1', 'C:/p'), calls: 2, verdict: 'approve' as const, builder: 'done' as const }
    saveSnapshot(dir, 7, 'C:/p', g)
    expect(loadSnapshot(dir, 7, 'C:/p')).toEqual(g)
    expect(readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([])
  })

  it('loads what was running as not running', () => {
    const g = emptyGraph('s1', 'C:/p')
    g.orch = 'thinking'
    g.builder = 'building'
    g.opus = 'awake'
    g.council.run = 'running'
    g.recall.run = true
    g.subagents.push(
      { id: 'a', name: 'builder', model: null, doing: null, startedAt: 1, endedAt: null, status: 'running' },
      { id: 'b', name: 'recall', model: null, doing: null, startedAt: 1, endedAt: 2, status: 'completed' },
    )
    saveSnapshot(dir, 1, 'C:/p', g)
    const back = loadSnapshot(dir, 1, 'C:/p')!
    expect(back.orch).toBe('idle')
    expect(back.builder).toBe('idle')
    expect(back.opus).toBe('idle')
    expect(back.council.run).toBe('idle')
    expect(back.recall.run).toBe(false)
    expect(back.subagents.map((a) => a.status)).toEqual(['unknown', 'completed'])
  })

  it('treats a missing, corrupt or wrong-shaped file as empty', () => {
    expect(loadSnapshot(dir, 1, 'C:/p')).toBeNull()
    writeFileSync(snapshotFile(dir, 1), '{not json')
    expect(loadSnapshot(dir, 1, 'C:/p')).toBeNull()
    writeFileSync(snapshotFile(dir, 1), JSON.stringify({ version: 1, folder: 'C:/p', graph: { sessionId: 3 } }))
    expect(loadSnapshot(dir, 1, 'C:/p')).toBeNull()
    writeFileSync(snapshotFile(dir, 1), JSON.stringify({ version: 9, folder: 'C:/p', graph: emptyGraph('s') }))
    expect(loadSnapshot(dir, 1, 'C:/p')).toBeNull()
  })

  it('ignores a snapshot saved for another folder or by an older build', () => {
    saveSnapshot(dir, 1, 'C:/p', emptyGraph('s'))
    expect(loadSnapshot(dir, 1, 'C:/other')).toBeNull()
    expect(loadSnapshot(dir, 1, 'c:\\P\\')).not.toBeNull()
    writeFileSync(snapshotFile(dir, 2), JSON.stringify({ version: 1, graph: emptyGraph('s') }))
    expect(loadSnapshot(dir, 2, 'C:/p')).toBeNull()
  })

  it('deletes the file, and is fine when it is already gone', () => {
    saveSnapshot(dir, 1, 'C:/p', emptyGraph('s'))
    deleteSnapshot(dir, 1)
    expect(existsSync(snapshotFile(dir, 1))).toBe(false)
    expect(() => deleteSnapshot(dir, 1)).not.toThrow()
  })
})
