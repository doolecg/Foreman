import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyGraph } from '../../../../../core/orchestration-graph'
import type { OrchestrationGraph } from '@shared/orchestration-graph'
import { GraphAtWidth } from './GraphView'

// No DOM in this suite, so the graph is rendered to markup at a chosen container width and read back.
const g = (patch: Partial<OrchestrationGraph> = {}): OrchestrationGraph => ({ ...emptyGraph('s', 'C:/p'), ...patch })
const html = (graph: OrchestrationGraph | null, width = 400, motion = true): string => renderToStaticMarkup(createElement(GraphAtWidth, { graph, width, motion }))
const litLinks = (markup: string): string[] => [...markup.matchAll(/data-link="([a-z-]+)" data-lit="true"/g)].map((m) => m[1]!)
const count = (markup: string, needle: string): number => markup.split(needle).length - 1

describe('GraphAtWidth: idle', () => {
  it('is all dim: no lit link, no active card, no moving class, no filled bar', () => {
    for (const graph of [null, g()]) {
      const m = html(graph)
      expect(m).toContain('IDLE')
      expect(litLinks(m)).toEqual([])
      expect(m).not.toContain('data-active="true"')
      expect(m).not.toContain('og-sweep')
      expect(m).not.toContain('data-fill="run"')
      expect(m).not.toContain('data-fill="full"')
      expect(m).not.toContain('og-blink')
    }
  })

  it('names every card, uses "chat" for the orchestrator and shows no percentages', () => {
    const m = html(g())
    for (const word of ['ORCHESTRATOR', 'OPUS 5.5', 'CODEGRAPH', 'HINDSIGHT', 'BUILDER', 'UI', 'CODE', 'RUN', 'chat']) expect(m).toContain(word)
    expect(m).not.toMatch(/\d+%/)
  })
})

describe('GraphAtWidth: an active builder', () => {
  const m = html(g({ builder: 'building', orch: 'thinking' }))

  it('sweeps the builder bar and marks only the working cards active', () => {
    expect(count(m, 'data-active="true"')).toBe(2)
    expect(m).toContain('aria-label="Builder: building"')
    expect(m).toContain('data-fill="run"')
    expect(m).toContain('og-sweep')
    expect(m).toContain('LIVE')
  })

  it('lights only the delegate link', () => {
    expect(litLinks(m)).toEqual(['delegate'])
  })
})

describe('GraphAtWidth: council failure and a rejected verdict', () => {
  const m = html(g({ verdict: 'reject', council: { ui: 'pass', code: 'fail', run: 'idle' }, builder: 'done' }))

  it('shows red crosses and ticks as glyphs, not only colour', () => {
    expect(m).toContain('✖')
    expect(m).toContain('✓')
    expect(m).toContain('aria-label="Council CODE: fail"')
    expect(m).toContain('text-destructive')
    expect(m).toContain('reject')
  })

  it('renames the link back to the brain and lights the right links', () => {
    expect(m).toContain('council fail → brain')
    expect(litLinks(m).sort()).toEqual(['back', 'f-ui', 'verdict'])
  })

  it('leaves the label plain when nothing failed', () => {
    const plain = html(g({ builder: 'done' }))
    expect(plain).toContain('done? → brain')
    expect(plain).not.toContain('council fail → brain')
    expect(litLinks(plain)).toEqual(['back'])
  })
})

describe('GraphAtWidth: links lit only for real state', () => {
  it('ask: opus awake', () => expect(litLinks(html(g({ opus: 'awake' })))).toEqual(['ask']))
  it('CTX: recall running (the compact layout also lights the results link back to the brain)', () => expect(litLinks(html(g({ recall: { cg: 0, hs: 0, grep: 0, saved: 0, run: true } }))).sort()).toEqual(['ctx', 'recalled']))
  it('commit to memory: approve and done?', () => expect(litLinks(html(g({ verdict: 'approve', orch: 'done?' }))).sort()).toEqual(['commit', 'verdict']))
  it('call: a council member running', () => expect(litLinks(html(g({ council: { ui: 'idle', code: 'running', run: 'idle' } })))).toEqual(['call']))
  it('a stale count lights nothing', () => expect(litLinks(html(g({ calls: 4, recall: { cg: 5, hs: 5, grep: 5, saved: 5, run: false } })))).toEqual([]))
})

describe('GraphAtWidth: layout by container width', () => {
  it('is compact below 700 px, with group frames but no loadout card', () => {
    const m = html(g(), 699)
    expect(m).toContain('data-layout="compact"')
    expect(m).not.toContain('data-layout="wide"')
    expect(m).not.toContain('LOADOUT')
    expect(m).toContain('border-dashed')
  })

  it('is wide from 700 px, with dashed group boxes and the loadout as dots only', () => {
    const m = html(g(), 700)
    expect(m).toContain('data-layout="wide"')
    expect(m).not.toContain('data-layout="compact"')
    expect(m).toContain('LOADOUT')
    expect(m).toContain('border-dashed')
    expect(m).toContain('aria-label="codegraph"')
    expect(m).not.toMatch(/\d+ (skills|mcp)/i)
  })

  it('wide keeps the links in words for a screen reader and lights only real traffic', () => {
    const m = html(g({ builder: 'building' }), 900)
    expect(m).toContain('delegate → builder: active')
    expect(m).toContain('ask: idle')
    expect(m).toContain('load: idle')
  })
})

describe('GraphAtWidth: size choice', () => {
  const sized = (size: 'small' | 'large', width: number): string => renderToStaticMarkup(createElement(GraphAtWidth, { graph: g(), width, motion: true, size }))
  it('Large is wide even in a narrow container, Small is compact even in a wide one', () => {
    expect(sized('large', 400)).toContain('data-layout="wide"')
    expect(sized('small', 1200)).toContain('data-layout="compact"')
  })
})

describe('GraphAtWidth: reduced motion', () => {
  const busy = g({ builder: 'building', opus: 'awake', council: { ui: 'running', code: 'idle', run: 'idle' } })

  it('adds no sweep, glow, flow or blink class when motion is off, but still shows the running state', () => {
    for (const width of [400, 900]) {
      const m = html(busy, width, false)
      for (const cls of ['og-sweep', 'og-march', 'og-blink']) expect(m).not.toContain(cls)
      expect(m).toContain('data-fill="run"')
      expect(m).toContain('data-active="true"')
      expect(m).toContain('LIVE')
    }
  })

  it('adds them when motion is on', () => {
    const m = html(busy, 400, true)
    for (const cls of ['og-sweep', 'og-march', 'og-blink']) expect(m).toContain(cls)
  })
})

describe('GraphAtWidth: freelancer', () => {
  const sub = (name: string, status: 'running' | 'completed', n = 0) => ({ id: `${name}${n}`, name, model: 'haiku', doing: `task ${n}`, startedAt: n, endedAt: null, status })

  it('is an empty dim frame when no freelancer ran, in both layouts', () => {
    for (const width of [400, 900]) {
      const m = html(g({ subagents: [sub('builder', 'running')] }), width)
      expect(m).toContain('FREELANCER')
      expect(m).toContain('no freelancers')
      expect(m).toContain('aria-label="Freelancers: none"')
    }
    expect(litLinks(html(g()))).toEqual([])
  })

  it('lists a running runner, lights the freelance link and moves the border', () => {
    for (const width of [400, 900]) {
      const m = html(g({ subagents: [sub('runner', 'running', 1)] }), width)
      expect(m).toContain('runner')
      expect(m).toContain('task 1')
      expect(m).toContain('1 seen')
      expect(litLinks(m)).toEqual(['free'])
      expect(m).toContain('freelance: active')
      expect(m).toContain('og-march')
    }
  })

  it('shows 4 rows and "+N more"', () => {
    const subs = Array.from({ length: 6 }, (_, i) => sub(`agent${i}`, 'completed', i))
    const m = html(g({ subagents: subs }))
    expect(count(m, 'data-status="completed"')).toBe(4)
    expect(m).toContain('+2 more')
  })

  it('motion off: a running card has a solid border and no travelling class', () => {
    const m = html(g({ subagents: [sub('runner', 'running')] }), 400, false)
    expect(m).not.toContain('og-march')
    expect(m).toContain('data-active="true"')
  })
})
