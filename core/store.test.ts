import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LESSON_LINKS_MIGRATION, LessonsDb } from './lessons-store'
import { MIGRATIONS, Store } from './store'

describe('store', () => {
  let store: Store
  beforeEach(() => {
    store = new Store(':memory:')
  })
  afterEach(() => store.close())

  it('adds the lesson link columns to a database that already has lessons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foreman-lessons-'))
    const file = join(dir, 'a.db')
    try {
      const old = new Store(file)
      const crew = old.createCrew('alpha', '/code/alpha')
      old.db.exec('ALTER TABLE lessons DROP COLUMN related; ALTER TABLE lessons DROP COLUMN consolidated_into')
      for (const c of ['session_id', 'turns', 'tokens', 'usd', 'tokens_estimated']) old.db.exec(`ALTER TABLE learn_runs DROP COLUMN ${c}`)
      for (const c of ['engineering', 'factory']) old.db.exec(`ALTER TABLE crews DROP COLUMN ${c}`)
      old.db.exec('ALTER TABLE scratch DROP COLUMN updated_at; DROP TABLE project_actions')
      old.db.exec(`PRAGMA user_version = ${MIGRATIONS.indexOf(LESSON_LINKS_MIGRATION)}`)
      old.db
        .prepare("INSERT INTO lessons (crew_id, text, kind, scope, created_at, updated_at) VALUES (?, 'keep it small', 'convention', 'project', 1, 1)")
        .run(crew.id)
      old.close()
      const s = new Store(file)
      try {
        expect(s.schemaVersion).toBe(MIGRATIONS.length)
        const db = new LessonsDb(s.db)
        const [l] = db.listLessons()
        expect(l).toMatchObject({ text: 'keep it small', related: [], consolidatedInto: null })
        expect(db.updateLesson(l!.id, { related: [7, 9], consolidatedInto: 3 })).toMatchObject({ related: [7, 9], consolidatedInto: 3 })
        expect(db.updateLesson(l!.id, { consolidatedInto: null }).consolidatedInto).toBeNull()
        const run = db.addLearnRun({ crewId: crew.id, runId: null, source: 'conversation', extracted: 0, written: 0, merged: 0, staled: 0, queued: 0, skipped: [], error: '', cli: 'claude', model: 'haiku', tokens: 1200, usd: 0.002, sessionId: 's1', turns: 12 })
        expect(db.lastLearnRun(crew.id)).toMatchObject({ id: run.id, tokens: 1200, usd: 0.002, tokensEstimated: false })
        expect(db.learnedTurns('s1')).toBe(12)
        expect(db.learnedTurns('other')).toBe(0)
      } finally {
        s.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('gives tiles from before updated_at their creation time as the last activity, and lets updateScratch move it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foreman-scratch-'))
    const file = join(dir, 'a.db')
    try {
      const old = new Store(file, () => 1234)
      const crew = old.createCrew('alpha', '/code/alpha')
      const tile = old.createScratch({ crewId: crew.id, title: 'Claude: alpha', agent: 'claude', cwd: '/code/alpha' })
      expect(tile).toMatchObject({ createdAt: 1234, updatedAt: 1234 })
      old.db.exec('ALTER TABLE scratch DROP COLUMN updated_at; DROP TABLE project_actions')
      old.db.exec(`PRAGMA user_version = ${MIGRATIONS.findIndex((m) => m.includes('ALTER TABLE scratch ADD COLUMN updated_at'))}`)
      old.close()
      const s = new Store(file, () => 9999)
      try {
        expect(s.getScratch(tile.id)).toMatchObject({ createdAt: 1234, updatedAt: 1234 })
        expect(s.updateScratch(tile.id, { updatedAt: 5000 })).toMatchObject({ createdAt: 1234, updatedAt: 5000 })
      } finally {
        s.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps projects, their order and the Playground', () => {
    const a = store.createCrew('alpha', '/code/alpha')
    const b = store.createCrew('beta', '/code/beta')
    expect(store.listCrews().map((c) => c.name)).toEqual(['Playground', 'alpha', 'beta'].filter((n) => n !== 'Playground' || store.getPlayground()))
    expect(store.updateCrew(a.id, { name: 'alpha 2' }).name).toBe('alpha 2')
    expect(store.reorderCrews([b.id, a.id]).filter((c) => c.kind === 'project').map((c) => c.id)).toEqual([b.id, a.id])
    expect(() => store.deleteCrew(store.ensurePlayground('/code/pg').id)).toThrow(/Playground cannot be deleted/)
  })

  it('keeps the Engineering and Factory flags per project, off by default and untouched by other edits', () => {
    const a = store.createCrew('alpha', '/code/alpha')
    expect(a).toMatchObject({ engineering: false, factory: false })
    expect(store.updateCrew(a.id, { engineering: true })).toMatchObject({ engineering: true, factory: false })
    expect(store.updateCrew(a.id, { factory: true, name: 'alpha 2' })).toMatchObject({ engineering: true, factory: true, name: 'alpha 2' })
    expect(store.updateCrew(a.id, { engineering: false })).toMatchObject({ engineering: false, factory: true })
    expect(store.getCrew(a.id)).toMatchObject({ engineering: false, factory: true })
  })

  it('stores presets with guidance text, and built-in presets are seeded once', () => {
    expect(store.listPresets().some((p) => p.builtin !== null)).toBe(true)
    const p = store.createPreset({ name: 'mine', agent: 'claude', model: 'sonnet', permissionMode: 'default', roleText: 'be brief' })
    expect(store.getPreset(p.id)).toMatchObject({ name: 'mine', roleText: 'be brief', builtin: null })
    expect(store.duplicatePreset(p.id).name).toBe('mine copy')
  })

  it('keeps teams as plain text (no seats)', () => {
    const t = store.createTeam({ name: 'Pair', rules: 'Two people, one diff.', description: 'Small.' })
    expect(store.updateTeam(t.id, { rules: 'Changed.' })).toMatchObject({ name: 'Pair', rules: 'Changed.', description: 'Small.' })
    expect(store.listTeams().some((x) => x.builtin !== null)).toBe(true)
  })

  it('records tile spend per project and the event log', () => {
    const crew = store.createCrew('alpha', '/code/alpha')
    const tile = store.createScratch({ crewId: crew.id, title: 'shell', agent: 'claude', cwd: '/code/alpha' })
    store.upsertMessageUsage('m1', { scratchId: tile.id, at: Date.now(), model: 'sonnet', inputTokens: 1, outputTokens: 1, costUsd: 0.5 })
    expect(store.spendSince(0, crew.id)).toBeCloseTo(0.5)
    expect(store.scratchSpend(crew.id, 0)).toEqual([{ scratchId: tile.id, costUsd: 0.5, turns: 1 }])
    store.addEvent('crew', 'Project alpha created', crew.id)
    expect(store.recentEvents(5)[0]).toMatchObject({ kind: 'crew', message: 'Project alpha created', crewId: crew.id })
  })

  it('drops the orchestration tables', () => {
    const names = (store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name)
    for (const gone of ['jobs', 'runs', 'operators', 'squads', 'messages', 'discord_bots']) expect(names).not.toContain(gone)
    for (const kept of ['crews', 'presets', 'teams', 'scratch', 'usage', 'events', 'settings', 'project_groups']) expect(names).toContain(kept)
  })
})
