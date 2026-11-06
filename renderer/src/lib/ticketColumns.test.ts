import { describe, expect, it } from 'vitest'
import { TICKET_STATUSES, type TicketListItem } from '@shared/tickets'
import { blockedBy, groupByStatus, legalMoves } from './ticketColumns'

const t = (id: string, status: TicketListItem['status'], deps: string[] = []): TicketListItem => ({
  id, title: id, status, mode: 'Solo', dependsOn: deps.map((d) => ({ id: d, reason: '' })), worker: '', branch: '', worktree: '', verification: 'Pending', integration: 'Pending', hasRd: true, hasEval: true,
})

describe('ticketColumns', () => {
  it('groups every status, in order, keeping board order', () => {
    const g = groupByStatus([t('T2', 'Ready'), t('T1', 'Ready'), t('T3', 'Done')])
    expect(g.map((c) => c.status)).toEqual([...TICKET_STATUSES])
    expect(g.find((c) => c.status === 'Ready')!.tickets.map((x) => x.id)).toEqual(['T2', 'T1'])
    expect(g.find((c) => c.status === 'Failed')!.tickets).toEqual([])
  })

  it('offers only legal moves', () => {
    expect(legalMoves(t('A', 'Draft'))).toEqual(['Ready'])
    expect(legalMoves(t('A', 'Done'))).toEqual([])
  })

  it('offers Done from Review only when verified and integrated', () => {
    const review = t('A', 'Review')
    expect(legalMoves(review)).toEqual(['In Progress', 'Failed'])
    expect(legalMoves({ ...review, verification: 'Passed', integration: 'Pending' })).not.toContain('Done')
    expect(legalMoves({ ...review, verification: 'Passed', integration: 'Merged' })).toContain('Done')
    expect(legalMoves({ ...review, verification: 'Passed', integration: 'Not needed' })).toContain('Done')
  })

  it('lists dependencies that are not Done', () => {
    const all = [t('A', 'Done'), t('B', 'Ready'), t('C', 'Ready', ['A', 'B', 'Z'])]
    expect(blockedBy(all[2]!, all)).toEqual(['B', 'Z'])
  })
})
