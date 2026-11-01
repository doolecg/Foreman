import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LEARN_SETTINGS, type LearnSettings, type Lesson } from '../shared/learn'
import { LearnService } from './learn'
import { LearnChangesDb } from './learn-changes'
import { PersonalMemory } from './learn-memory'
import { LessonsDb } from './lessons-store'
import { Store } from './store'

const A = 'Cart totals are computed in integer cents, not in floats'
const B = 'Cart totals are rounded once in integer cents'
const C = 'Cart totals in integer cents are shown with two decimals by the formatter'

describe('lesson consolidation', () => {
  let store: Store
  let crewId: number
  let dir: string
  let settings: LearnSettings
  let answers: string[]
  let prompts: string[]
  let retained: Array<{ content: string; tags: string[] }>
  let db: LessonsDb
  let changes: LearnChangesDb

  beforeEach(() => {
    store = new Store(':memory:')
    crewId = store.createCrew('shop', '/code/shop').id
    dir = mkdtempSync(join(tmpdir(), 'foreman-consolidate-'))
    settings = { ...DEFAULT_LEARN_SETTINGS, hindsight: true, codegraph: false, memory: true, review: 'auto', mode: 'controlled', minUserTurns: 0, minTokens: 0 }
    answers = []
    prompts = []
    retained = []
    db = new LessonsDb(store.db)
    changes = new LearnChangesDb(store.db)
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const service = (extra: Partial<ConstructorParameters<typeof LearnService>[0]> = {}) =>
    new LearnService({
      store,
      db,
      changes,
      hindsight: {
        retain: async (_b, content, tags) => (retained.push({ content, tags }), { ok: true }),
        recall: async () => ({ ok: true, items: [] }),
        status: async () => ({ url: 'u', managed: true, state: 'running', detail: '' }),
      },
      git: async () => '',
      model: async (p) => (prompts.push(p), answers.shift() ?? '{}'),
      settings: () => settings,
      memory: new PersonalMemory(() => join(dir, 'memory')),
      transcript: () => 'user: hi\nassistant: ok',
      exists: () => false,
      installedSkills: () => [],
      ...extra,
    })

  const add = (text: string, o: Partial<Lesson> = {}): Lesson =>
    db.addLesson({ crewId, text, kind: 'convention', scope: 'project', files: ['core/cart.ts'], symbols: ['cartTotal'], sourceJobs: [1], status: 'active', ...o })
  const merge = (ids: number[], o: object = {}) => JSON.stringify({ text: 'Cart totals are summed in integer cents and rounded once after summing', replaces: ids, files: ['core/cart.ts'], symbols: ['cartTotal'], ...o })

  it('merges a group into the lowest id and retires the others', async () => {
    const a = add(A)
    const b = add(B, { files: ['core/cart.ts', 'core/money.ts'], sourceJobs: [2] })
    db.updateLesson(b.id, { hits: 2 })
    const svc = service()
    answers.push(merge([a.id, b.id], { files: ['core/money.ts'] }))
    const r = await svc.consolidate(crewId, { manual: true })
    expect(r).toMatchObject({ merged: 1, failed: 0, proposed: 0 })
    const kept = db.getLesson(a.id)!
    expect(kept.text).toContain('rounded once')
    expect(kept.files).toEqual(['core/cart.ts', 'core/money.ts'])
    expect(kept.hits).toBe(a.hits + 2)
    expect(kept.sourceJobs).toEqual([1, 2])
    expect(db.getLesson(b.id)).toMatchObject({ status: 'deleted', consolidatedInto: a.id })
    expect(prompts[0]).toContain(`#${a.id} [convention] ${A}`)
    expect(changes.list({ crewId }).filter((c) => c.status === 'applied' && c.proposal.startsWith('Consolidation'))).toHaveLength(2)
  })

  it('refuses ids outside the group, new files and drifting text, recording failures', async () => {
    const a = add(A)
    const b = add(B)
    const svc = service()
    answers.push(merge([a.id, 9999]), merge([a.id, b.id], { files: ['secret.ts'] }), merge([a.id, b.id], { text: 'Unrelated banana sandwich recipe' }))
    for (let i = 0; i < 3; i++) await svc.consolidate(crewId, { manual: true })
    expect(db.getLesson(a.id)!.text).toBe(A)
    expect(db.getLesson(b.id)!.status).toBe('active')
    expect(changes.list({ crewId, status: 'failed' })).toHaveLength(3)
  })

  it('applies a result with a command in it too', async () => {
    const a = add(A)
    const b = add(B)
    const svc = service()
    answers.push(merge([a.id, b.id], { text: 'Cart totals are summed in integer cents; always run `npm test` after summing' }))
    const r = await svc.consolidate(crewId, { manual: true })
    expect(r.proposed).toBe(0)
    expect(r.merged).toBe(1)
    expect(changes.list({ crewId, status: 'proposed' })).toHaveLength(0)
  })

  it('suggest mode proposes nothing (it applies) and off mode does nothing', async () => {
    const a = add(A)
    const b = add(B)
    settings.mode = 'suggest'
    const svc = service()
    answers.push(merge([a.id, b.id]))
    const r = await svc.consolidate(crewId, { manual: true })
    expect(r.proposed).toBe(0)
    expect(r.merged).toBe(1)
    expect(db.getLesson(b.id)!.status).not.toBe('active')
    settings.mode = 'off'
    expect((await svc.consolidate(crewId, { manual: true })).skipped).toBe('learning is off')
    expect(prompts).toHaveLength(1)
  })

  it('rollback restores text, files and symbols and reactivates the retired lesson', async () => {
    const a = add(A)
    const b = add(B, { files: ['core/cart.ts', 'core/money.ts'], symbols: ['cartTotal', 'roundCents'] })
    const svc = service()
    answers.push(merge([a.id, b.id]))
    await svc.consolidateNow(crewId)
    expect(db.getLesson(a.id)!.symbols).toEqual(['cartTotal', 'roundCents'])
    const done = changes.list({ crewId, status: 'applied' }).filter((c) => c.proposal.startsWith('Consolidation'))
    for (const c of done) await svc.rollback(c.id)
    expect(db.getLesson(a.id)).toMatchObject({ text: A, files: ['core/cart.ts'], symbols: ['cartTotal'] })
    expect(db.getLesson(b.id)).toMatchObject({ status: 'active', consolidatedInto: null })
  })

  it('rebuilds related links after a learn run and with no model call', async () => {
    const a = add(A)
    const b = add(C)
    const svc = service({ transcript: () => 'user: hi\nassistant: ok' })
    await svc.onConversationEnd(crewId, 'sess')
    expect(db.getLesson(a.id)!.related).toEqual([b.id])
    expect(db.getLesson(b.id)!.related).toEqual([a.id])
  })

  it('marks Hindsight items with the lesson id and the ids they supersede', async () => {
    const a = add(A)
    const b = add(B)
    const svc = service()
    answers.push(merge([a.id, b.id]))
    await svc.consolidate(crewId, { manual: true })
    const item = retained.at(-1)!
    expect(item.content.startsWith(`LESSON #${a.id} [convention] Cart totals are summed`)).toBe(true)
    expect(item.tags).toContain(`lesson:${a.id}`)
    expect(item.tags).toContain(`supersedes:${b.id}`)
  })

  it('has no daily Hindsight cap', async () => {
    const svc = service()
    const lessons = Array.from({ length: 23 }, (_, i) => add(`Distinct lesson number ${i} about topic${i}`, { files: [`f${i}.ts`], symbols: [] }))
    for (const l of lessons) await svc.setLessonStatus(l.id, 'active')
    expect(retained).toHaveLength(23)
    expect(lessons.filter((l) => !db.getLesson(l.id)!.stores.includes('hindsight'))).toHaveLength(0)
  })

  const folding = () => prompts.filter((p) => p.startsWith('You merge') || p.startsWith('You tighten'))

  it('stops at the call budget, and runs after every learn step whatever the threshold', async () => {
    const a = add(A)
    const b = add(B)
    add('Checkout emails are queued through the mailer service worker', { files: ['core/mail.ts'], symbols: ['sendMail'] })
    add('Checkout emails retry through the mailer queue worker on failure', { files: ['core/mail.ts'], symbols: ['sendMail'] })
    settings.maxCallsPerReview = 1
    const svc = service()
    answers.push(merge([a.id, b.id]), '{}')
    const r = await svc.consolidate(crewId, { manual: true })
    expect(folding()).toHaveLength(1)
    expect(r.skipped).toContain('model calls')

    settings.maxCallsPerReview = 8
    settings.consolidateAt = 500
    await svc.onConversationEnd(crewId, 'sess')
    expect(folding().length).toBeGreaterThanOrEqual(1)
  })
})
