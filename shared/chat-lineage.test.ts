import { describe, expect, it } from 'vitest'
import { agentPath, buildCrumbs, drillDirection, needsClip, parentPath, subagentOf, truncateLabel, validPath } from './chat-lineage'

const agents = [
  { id: 'a', parent: null },
  { id: 'b', parent: 'a' },
  { id: 'c', parent: 'b' },
  { id: 'x', parent: null },
]
const titles: Record<string, string> = { a: 'Spike', b: 'Explore', c: 'Reader', x: 'Other' }
const titleOf = (id: string) => titles[id] ?? id

describe('agentPath', () => {
  it('walks the parents up, outermost first', () => {
    expect(agentPath(agents, 'c')).toEqual(['a', 'b', 'c'])
    expect(agentPath(agents, 'a')).toEqual(['a'])
  })
  it('is null for an unknown agent', () => {
    expect(agentPath(agents, 'zzz')).toBeNull()
  })
  it('stops at a missing parent and survives a cycle', () => {
    expect(agentPath([{ id: 'q', parent: 'gone' }], 'q')).toEqual(['q'])
    expect(agentPath([{ id: 'p', parent: 'q' }, { id: 'q', parent: 'p' }], 'p')).toEqual(['q', 'p'])
  })
})

describe('validPath', () => {
  it('keeps a path whose agents all exist', () => {
    expect(validPath(agents, ['a', 'b'])).toEqual(['a', 'b'])
  })
  it('cuts at the first agent that is gone', () => {
    expect(validPath(agents, ['a', 'gone', 'c'])).toEqual(['a'])
    expect(validPath(agents, ['gone'])).toEqual([])
  })
})

describe('parentPath and drillDirection', () => {
  it('goes up one level and stays at the main thread', () => {
    expect(parentPath(['a', 'b'])).toEqual(['a'])
    expect(parentPath([])).toEqual([])
  })
  it('animates in when going deeper or sideways and out when going up', () => {
    expect(drillDirection([], ['a'])).toBe('in')
    expect(drillDirection(['a'], ['x'])).toBe('in')
    expect(drillDirection(['a', 'b'], ['a'])).toBe('out')
    expect(drillDirection(['a'], [])).toBe('out')
  })
})

describe('buildCrumbs', () => {
  it('lists project, thread and each agent, with every earlier crumb a way back', () => {
    const c = buildCrumbs('Foreman', 'First run', ['a', 'b'], titleOf)
    expect(c.map((x) => x.label)).toEqual(['Foreman', 'First run', 'Spike', 'Explore'])
    expect(c.map((x) => x.to)).toEqual([[], [], ['a'], null])
  })
  it('marks the thread as current at the main conversation', () => {
    const c = buildCrumbs('Foreman', 'First run', [], titleOf)
    expect(c.map((x) => x.to)).toEqual([[], null])
  })
  it('leaves out an unnamed project and names an empty thread', () => {
    expect(buildCrumbs(null, '', ['a'], titleOf).map((x) => x.label)).toEqual(['Chat', 'Spike'])
  })
  it('truncates a long title and keeps the whole one', () => {
    const c = buildCrumbs('P', 'T', ['a'], () => 'x'.repeat(50), 10)
    expect(c[2]!.label).toBe(`${'x'.repeat(9)}…`)
    expect(c[2]!.full).toHaveLength(50)
  })
})

describe('subagentOf', () => {
  it('names the thread for a first-level agent and the parent agent deeper down', () => {
    expect(subagentOf(['a'], 'First run', titleOf)).toEqual({ lead: 'Subagent of', parent: 'First run', full: 'First run' })
    expect(subagentOf(['a', 'b'], 'First run', titleOf).parent).toBe('Spike')
  })
  it('truncates a long parent title', () => {
    expect(subagentOf(['a'], 'y'.repeat(80), titleOf, 20).parent).toBe(`${'y'.repeat(19)}…`)
  })
})

describe('truncateLabel', () => {
  it('collapses whitespace and leaves short text alone', () => {
    expect(truncateLabel('  a \n b  ')).toBe('a b')
  })
})

describe('needsClip', () => {
  it('clips by line count and by wrapped length', () => {
    expect(needsClip('short')).toBe(false)
    expect(needsClip(Array(9).fill('line').join('\n'))).toBe(true)
    expect(needsClip(Array(8).fill('line').join('\n'))).toBe(false)
    expect(needsClip('w'.repeat(84 * 8 + 1))).toBe(true)
  })
})
