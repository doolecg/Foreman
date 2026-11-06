import { describe, expect, it } from 'vitest'
import { dependencyDepth, downstreamOf, planNext, topologicalOrder } from './scheduler'
import type { TicketRow, TicketStatus } from '../shared/tickets'

const t = (id: string, status: TicketStatus = 'Ready', deps: string[] = []): TicketRow => ({
  id,
  title: id,
  status,
  mode: 'Solo',
  dependsOn: deps.map((d) => ({ id: d, reason: '' })),
  worker: status === 'In Progress' ? 'w' : '',
  branch: '',
  worktree: '',
  verification: 'Pending',
  integration: 'Pending',
})

describe('helpers', () => {
  it('computes depth and order for a diamond', () => {
    const rows = [t('T-004', 'Draft', ['T-002', 'T-003']), t('T-003', 'Draft', ['T-001']), t('T-002', 'Draft', ['T-001']), t('T-001')]
    expect([...dependencyDepth(rows)].sort()).toEqual([['T-001', 0], ['T-002', 1], ['T-003', 1], ['T-004', 2]])
    expect(topologicalOrder(rows)).toEqual(['T-001', 'T-002', 'T-003', 'T-004'])
  })

  it('finds everything downstream, transitively', () => {
    const rows = [t('T-001'), t('T-002', 'Draft', ['T-001']), t('T-003', 'Draft', ['T-002']), t('T-004')]
    expect(downstreamOf(rows, 'T-001')).toEqual(['T-002', 'T-003'])
    expect(downstreamOf(rows, 'T-004')).toEqual([])
  })

  it('survives a cycle', () => {
    const rows = [t('T-001', 'Ready', ['T-002']), t('T-002', 'Ready', ['T-001'])]
    expect(() => topologicalOrder(rows)).not.toThrow()
    expect(planNext(rows, { maxWorkers: 3 }).start).toEqual([])
  })
})

describe('planNext', () => {
  it('starts only the head of a linear chain', () => {
    const rows = [t('T-001'), t('T-002', 'Ready', ['T-001']), t('T-003', 'Ready', ['T-002'])]
    const plan = planNext(rows, { maxWorkers: 3 })
    expect(plan.start).toEqual(['T-001'])
    expect(plan.waiting).toEqual([
      { id: 'T-002', reason: 'waiting on T-001 (Ready)' },
      { id: 'T-003', reason: 'waiting on T-002 (Ready)' },
    ])
  })

  it('walks a diamond: the join waits for both branches', () => {
    const rows = [t('T-001', 'Done'), t('T-002', 'Ready', ['T-001']), t('T-003', 'Ready', ['T-001']), t('T-004', 'Ready', ['T-002', 'T-003'])]
    const plan = planNext(rows, { maxWorkers: 3 })
    expect(plan.start).toEqual(['T-002', 'T-003'])
    expect(plan.waiting).toEqual([{ id: 'T-004', reason: 'waiting on T-002 (Ready), T-003 (Ready)' }])
    const after = planNext([t('T-001', 'Done'), t('T-002', 'Done'), t('T-003', 'Done'), t('T-004', 'Ready', ['T-002', 'T-003'])], { maxWorkers: 3 })
    expect(after.start).toEqual(['T-004'])
  })

  it('respects the cap, counting In Progress tickets', () => {
    const rows = [t('T-001', 'In Progress'), t('T-002', 'In Progress'), t('T-003'), t('T-004')]
    const plan = planNext(rows, { maxWorkers: 3 })
    expect(plan.start).toEqual(['T-003'])
    expect(plan.waiting).toEqual([{ id: 'T-004', reason: 'cap 3 of 3 in use' }])
    expect(planNext(rows, { maxWorkers: 2 }).start).toEqual([])
  })

  it('starts two independent tickets together', () => {
    expect(planNext([t('T-001'), t('T-002')], { maxWorkers: 3 })).toEqual({ start: ['T-001', 'T-002'], waiting: [] })
  })

  it('serialises tickets that touch the same file or folder', () => {
    const rows = [t('T-003'), t('T-004')]
    const plan = planNext(rows, { maxWorkers: 3, touches: { 'T-003': ['core/foo.ts'], 'T-004': ['core/'] } })
    expect(plan.start).toEqual(['T-003'])
    expect(plan.waiting).toEqual([{ id: 'T-004', reason: 'overlaps T-003 on core/foo.ts' }])
    expect(planNext(rows, { maxWorkers: 3, touches: { 'T-003': ['core/a.ts'], 'T-004': ['core/b.ts'] } }).start).toEqual(['T-003', 'T-004'])
  })

  it('treats a//b and a/./b as the same path as a/b', () => {
    const rows = [t('T-003'), t('T-004')]
    for (const odd of ['core//foo.ts', 'core/./foo.ts', './core/./foo.ts', 'core\\foo.ts']) {
      const plan = planNext(rows, { maxWorkers: 3, touches: { 'T-003': ['core/foo.ts'], 'T-004': [odd] } })
      expect(plan.waiting, odd).toEqual([{ id: 'T-004', reason: 'overlaps T-003 on core/foo.ts' }])
    }
  })

  it('holds a ticket that overlaps one already In Progress', () => {
    const rows = [t('T-001', 'In Progress'), t('T-002')]
    const plan = planNext(rows, { maxWorkers: 3, touches: { 'T-001': ['core/foo.ts'], 'T-002': ['core/foo.ts'] } })
    expect(plan.waiting).toEqual([{ id: 'T-002', reason: 'overlaps T-001 on core/foo.ts' }])
  })

  it('lets the lower id go first even when it is deeper in the graph', () => {
    const rows = [t('T-001', 'Done'), t('T-002', 'Ready', ['T-001']), t('T-005')]
    const plan = planNext(rows, { maxWorkers: 3, touches: { 'T-002': ['x'], 'T-005': ['x'] } })
    expect(plan.start).toEqual(['T-002'])
    expect(plan.waiting).toEqual([{ id: 'T-005', reason: 'overlaps T-002 on x' }])
  })

  it('ignores overlap when one ticket depends on the other', () => {
    // T-003 depends on T-001 through the Done T-002, so they may run together even on the same file.
    const rows = [t('T-001', 'In Progress'), t('T-002', 'Done', ['T-001']), t('T-003', 'Ready', ['T-002'])]
    expect(planNext(rows, { maxWorkers: 3, touches: { 'T-001': ['a'], 'T-003': ['a'] } }).start).toEqual(['T-003'])
    // Unrelated tickets on the same file still serialise.
    const apart = [t('T-001', 'In Progress'), t('T-003', 'Ready')]
    expect(planNext(apart, { maxWorkers: 3, touches: { 'T-001': ['a'], 'T-003': ['a'] } }).start).toEqual([])
    // A waiting dependent does not clash with its own upstream.
    const dep = [t('T-001', 'Ready'), t('T-002', 'Ready', ['T-001'])]
    expect(planNext(dep, { maxWorkers: 3, touches: { 'T-001': ['a'], 'T-002': ['a'] } })).toEqual({
      start: ['T-001'],
      waiting: [{ id: 'T-002', reason: 'waiting on T-001 (Ready)' }],
    })
  })

  it('reports downstream of a failed ticket as blocked by the failure', () => {
    const rows = [t('T-001', 'Failed'), t('T-002', 'Ready', ['T-001']), t('T-003', 'Draft', ['T-002']), t('T-004', 'Ready')]
    const plan = planNext(rows, { maxWorkers: 3 })
    expect(plan.start).toEqual(['T-004'])
    expect(plan.waiting).toEqual([
      { id: 'T-002', reason: 'blocked by failed T-001' },
      { id: 'T-003', reason: 'blocked by failed T-001' },
    ])
  })

  it('never starts Draft, Blocked, Review, Done, Failed or In Progress tickets', () => {
    const rows = (['Draft', 'Blocked', 'Review', 'Done', 'Failed', 'In Progress'] as TicketStatus[]).map((s, i) => t(`T-00${i + 1}`, s))
    expect(planNext(rows, { maxWorkers: 8 })).toEqual({ start: [], waiting: [] })
  })

  it('is deterministic whatever the row order', () => {
    const rows = [t('T-003'), t('T-001'), t('T-002', 'Ready', ['T-001']), t('T-004')]
    const a = planNext(rows, { maxWorkers: 2 })
    const b = planNext([...rows].reverse(), { maxWorkers: 2 })
    expect(a).toEqual(b)
    expect(a.start).toEqual(['T-001', 'T-003'])
  })

  it('compares paths ignoring case, backslashes, ./ and a trailing slash', () => {
    const plan = planNext([t('T-001'), t('T-002')], { maxWorkers: 3, touches: { 'T-001': ['.\\Core\\Foo.ts'], 'T-002': ['core/'] } })
    expect(plan.start).toEqual(['T-001'])
    expect(plan.waiting).toEqual([{ id: 'T-002', reason: 'overlaps T-001 on core/foo.ts' }])
  })

  it('never lets a bad cap switch the limit off', () => {
    const rows = [t('T-001'), t('T-002'), t('T-003'), t('T-004')]
    expect(planNext(rows, { maxWorkers: NaN }).start).toEqual(['T-001', 'T-002', 'T-003'])
    expect(planNext(rows, { maxWorkers: 0 }).start).toEqual(['T-001'])
    expect(planNext(rows, { maxWorkers: -4 }).start).toEqual(['T-001'])
    expect(planNext(rows, { maxWorkers: Infinity }).start).toEqual(['T-001', 'T-002', 'T-003'])
    expect(planNext(Array.from({ length: 12 }, (_, i) => t(`T-0${i + 10}`)), { maxWorkers: 50 }).start).toHaveLength(8)
  })

  it('names a missing dependency', () => {
    expect(planNext([t('T-002', 'Ready', ['T-009'])], { maxWorkers: 3 }).waiting).toEqual([{ id: 'T-002', reason: 'waiting on T-009 (missing)' }])
  })
})
