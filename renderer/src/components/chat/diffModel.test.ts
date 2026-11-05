import { describe, expect, it } from 'vitest'
import type { ChatItem, DiffFile, ToolItem, UserItem } from '@shared/claude-chat'
import { collectFileDiffs, filesForScope, latestTurnItems, viewedCount, viewedLabel } from './diffModel'

const tool = (id: string, over: Partial<ToolItem> = {}): ChatItem => ({
  kind: 'tool',
  id,
  parent: null,
  name: 'Edit',
  input: {},
  partial: '',
  summary: '',
  status: 'done',
  result: null,
  diff: null,
  background: false,
  startedAt: 1000,
  endedAt: 2000,
  ...over,
})
const user = (id: string, over: Partial<UserItem> = {}): ChatItem => ({ kind: 'user', id, parent: null, text: 'hi', images: [], queued: false, at: 1, ...over })
const diff = (path: string, lines: string[], created = false): DiffFile => ({
  path,
  created,
  added: lines.filter((l) => l[0] === '+').length,
  removed: lines.filter((l) => l[0] === '-').length,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }],
})

describe('collectFileDiffs', () => {
  it('merges edits to one file: counts add up, hunks follow each other', () => {
    const out = collectFileDiffs([tool('a', { diff: diff('C:\\p\\a.ts', ['-x', '+y']) }), tool('b', { diff: diff('C:/p/a.ts', ['+z']) })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ path: 'C:/p/a.ts', added: 2, removed: 1 })
    expect(out[0]!.hunks).toHaveLength(2)
  })

  it('skips failed calls and other tools, builds a diff from the input when there is none', () => {
    const out = collectFileDiffs([
      tool('a', { status: 'failed', diff: diff('/p/a.ts', ['+1']) }),
      tool('b', { name: 'Read', diff: diff('/p/r.ts', ['+1']) }),
      tool('c', { name: 'Write', input: { file_path: '/p/new.ts', content: 'one\ntwo' } }),
    ])
    expect(out.map((f) => [f.path, f.added, f.removed, f.created])).toEqual([['/p/new.ts', 2, 0, true]])
  })

  it('does not change the item diff it merges into', () => {
    const first = diff('/p/a.ts', ['+1'])
    collectFileDiffs([tool('a', { diff: first }), tool('b', { diff: diff('/p/a.ts', ['+2']) })])
    expect(first.hunks).toHaveLength(1)
  })
})

describe('latestTurnItems and scope', () => {
  const items = [user('u1'), tool('a', { diff: diff('/p/a.ts', ['+1']) }), user('u2'), tool('b', { diff: diff('/p/b.ts', ['+1', '+2']) })]

  it('starts at the last owner message', () => {
    expect(latestTurnItems(items).map((i) => i.id)).toEqual(['u2', 'b'])
  })

  it('ignores nested (parented) user items and falls back to all items', () => {
    expect(latestTurnItems([tool('a'), user('u', { parent: 'x' })])).toHaveLength(2)
  })

  it('"turn" holds the latest turn only, "all" the session', () => {
    expect(filesForScope(items, 'turn').map((f) => f.path)).toEqual(['/p/b.ts'])
    expect(filesForScope(items, 'all').map((f) => f.path)).toEqual(['/p/a.ts', '/p/b.ts'])
  })
})

describe('viewed', () => {
  it('counts viewed files that are in the list', () => {
    const files = [{ path: 'a' }, { path: 'b' }]
    expect(viewedCount(files, new Set(['a', 'gone']))).toBe(1)
    expect(viewedLabel(1, 2)).toBe('1/2 viewed')
  })
})
