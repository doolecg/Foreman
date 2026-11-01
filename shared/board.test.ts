import { describe, expect, it } from 'vitest'
import type { ChatItem } from './claude-chat'
import { activitySummary, boardCounts, buildCards, filterCards, lastAssistantLine, liveSummary, planUsage, sortCards, type BoardCard, type BoardLive } from './board'
import type { Crew, ScratchTerminal } from './types'

const crew = (id: number, name: string): Crew => ({ id, name, folder: '', createdAt: 0, prjNumber: id, sortOrder: id, groupId: null, kind: 'project', engineering: false, factory: false })
const row = (id: number, o: Partial<ScratchTerminal> = {}): ScratchTerminal => ({ id, crewId: 1, title: `t${id}`, agent: 'claude', model: '', effort: '', presetId: null, cwd: '', sessionId: null, view: 'chat', createdAt: 10, updatedAt: 20, ...o })
const user = (id: string): ChatItem => ({ kind: 'user', id, parent: null, text: 'hi', images: [], queued: false, at: 0 })
const text = (id: string, md: string, parent: string | null = null): ChatItem => ({ kind: 'text', id, parent, md, streaming: false })
const turn = (phase: 'idle' | 'working' | 'waiting', pendingLabel: string | null = null) => ({ phase, word: '', startedAt: null, elapsedMs: 0, outputTokens: 0, pendingCount: pendingLabel ? 1 : 0, pendingLabel })
const chat = (process: 'ready' | 'crashed' | 'stopped', t: ReturnType<typeof turn>, items: ChatItem[]) => ({ process, turn: t, items, model: null, modelDisplayName: 'Sonnet 5.5' })

describe('lastAssistantLine', () => {
  it('takes the first line of the latest main-thread text, without markdown marks', () => {
    expect(lastAssistantLine([text('a', 'old'), text('b', '## Done\n\nmore'), text('c', 'inside agent', 'sub')])).toBe('Done')
  })
  it('is null without text', () => {
    expect(lastAssistantLine([user('u')])).toBeNull()
  })
})

describe('liveSummary', () => {
  it('maps the chat to a status and a line', () => {
    expect(liveSummary(chat('ready', turn('waiting', 'Edit: a.ts'), [user('u')]), '')).toMatchObject({ status: 'needs', line: 'Edit: a.ts' })
    expect(liveSummary(chat('ready', turn('working'), [user('u')]), 'Claude is reading a.ts')).toMatchObject({ status: 'working', line: 'Claude is reading a.ts' })
    expect(liveSummary(chat('crashed', turn('idle'), []), '')).toMatchObject({ status: 'failed' })
    expect(liveSummary(chat('ready', turn('idle'), [user('u'), text('t', 'All done.\nDetails')]), '')).toMatchObject({ status: 'done', line: 'All done.', model: 'Sonnet 5.5' })
  })
  it('is quiet for a chat with no message yet', () => {
    expect(liveSummary(chat('ready', turn('idle'), []), '')).toMatchObject({ status: 'quiet', line: null })
  })
})

describe('buildCards', () => {
  const groups = [
    { crew: crew(1, 'Foreman'), rows: [row(1), row(2, { updatedAt: 10 }), row(3, { agent: 'shell' }), row(4, { updatedAt: 30 })] },
    { crew: crew(2, 'Playground'), rows: [] },
  ]
  const live = new Map<number, BoardLive>([[1, { status: 'needs', line: 'ok?', model: null }]])

  it('keeps open tiles and closed threads with history, only claude and opencode', () => {
    const cards = buildCards(groups, new Set([1, 2, 3]), live)
    expect(cards.map((c) => c.row.id)).toEqual([1, 4, 2])
    expect(cards[0]).toMatchObject({ project: 'Foreman', status: 'needs', line: 'ok?', open: true })
    expect(cards[1]).toMatchObject({ status: 'quiet', open: false })
  })
  it('puts Needs you first, then newest', () => {
    const cards = [{ id: 1, s: 'working', at: 50 }, { id: 2, s: 'needs', at: 5 }, { id: 3, s: 'done', at: 60 }].map((c) => ({ row: row(c.id, { updatedAt: c.at }), project: '', open: true, status: c.s, line: null, model: null }) as BoardCard)
    expect(sortCards(cards).map((c) => c.row.id)).toEqual([2, 3, 1])
  })
})

describe('counts and filters', () => {
  const mk = (id: number, status: BoardCard['status']): BoardCard => ({ row: row(id), project: '', open: true, status, line: null, model: null })
  const cards = [mk(1, 'working'), mk(2, 'working'), mk(3, 'needs'), mk(4, 'done'), mk(5, 'failed')]
  it('counts All, Working and Needs you', () => {
    expect(boardCounts(cards)).toEqual({ all: 5, working: 2, needs: 1 })
  })
  it('filters', () => {
    expect(filterCards(cards, 'all')).toHaveLength(5)
    expect(filterCards(cards, 'working').map((c) => c.row.id)).toEqual([1, 2])
    expect(filterCards(cards, 'needs').map((c) => c.row.id)).toEqual([3])
  })
  it('summarises activity', () => {
    expect(activitySummary({ all: 9, working: 3, needs: 1 })).toBe('3 working, 1 needs you')
    expect(activitySummary({ all: 9, working: 0, needs: 1 })).toBe('1 needs you')
    expect(activitySummary({ all: 9, working: 0, needs: 0 })).toBeNull()
  })
})

describe('planUsage', () => {
  it('reads the session and weekly windows of Claude only', () => {
    const w = (label: string, usedPct: number | null) => ({ label, usedPct })
    const out = planUsage([
      { id: 'claude', name: 'Claude', windows: [w('5-hour', 13), w('7-day', 43), w('7-day (Opus)', 80)] },
      { id: 'openai', name: 'OpenAI', windows: [w('5-hour', 99)] },
    ])
    expect(out).toEqual({ fiveHour: 13, sevenDay: 43 })
    expect(planUsage([])).toEqual({ fiveHour: null, sevenDay: null })
  })
})
