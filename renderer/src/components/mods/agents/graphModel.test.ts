import { describe, expect, it } from 'vitest'
import { emptyGraph } from '../../../../../core/orchestration-graph'
import type { OrchestrationGraph } from '@shared/orchestration-graph'
import { COMPACT_BELOW, brainCard, builderCard, builderTask, councilCard, freelancerView, freelancers, graphIsActive, graphLinks, layoutForSize, layoutForWidth, orchestratorCard, recallCounts } from './graphModel'

const g = (patch: Partial<OrchestrationGraph> = {}): OrchestrationGraph => ({ ...emptyGraph('s', 'C:/p'), ...patch })
const LINKS = ['ask', 'verdict', 'commit', 'ctx', 'delegate', 'back', 'load', 'call'] as const

describe('layoutForSize', () => {
  it('follows the choice, and the width only when there is none', () => {
    expect(layoutForSize('large', 300)).toBe('wide')
    expect(layoutForSize('small', 1200)).toBe('compact')
    expect(layoutForSize(undefined, 300)).toBe('compact')
    expect(layoutForSize(undefined, 900)).toBe('wide')
  })
})

describe('layoutForWidth', () => {
  it('is compact below 700 px and wide from there', () => {
    expect(COMPACT_BELOW).toBe(700)
    expect(layoutForWidth(0)).toBe('compact')
    expect(layoutForWidth(699)).toBe('compact')
    expect(layoutForWidth(700)).toBe('wide')
    expect(layoutForWidth(1200)).toBe('wide')
  })
})

describe('graphLinks', () => {
  it('lights nothing for an idle or missing graph', () => {
    for (const graph of [null, g()]) {
      const l = graphLinks(graph)
      for (const k of LINKS) expect(l[k]).toBe(false)
      expect(l.findings).toEqual({ ui: false, code: false, run: false })
      expect(l.findingsAny).toBe(false)
      expect(l.backLabel).toBe('done? → brain')
    }
  })

  it('ask is lit only while Opus is awake', () => {
    expect(graphLinks(g({ opus: 'awake' })).ask).toBe(true)
    expect(graphLinks(g({ opus: 'idle', verdict: 'approve' })).ask).toBe(false)
  })

  it('verdict is lit once a verdict is set', () => {
    expect(graphLinks(g({ verdict: 'reject' })).verdict).toBe(true)
    expect(graphLinks(g({ verdict: 'approve' })).verdict).toBe(true)
  })

  it('commit to memory needs an approve and the orchestrator at done?', () => {
    expect(graphLinks(g({ verdict: 'approve', orch: 'done?' })).commit).toBe(true)
    expect(graphLinks(g({ verdict: 'approve', orch: 'thinking' })).commit).toBe(false)
    expect(graphLinks(g({ verdict: 'reject', orch: 'done?' })).commit).toBe(false)
    expect(graphLinks(g({ orch: 'done?' })).commit).toBe(false)
  })

  it('CTX follows recall.run and delegate follows the builder building', () => {
    expect(graphLinks(g({ recall: { cg: 1, hs: 1, grep: 0, saved: 0, run: true } })).ctx).toBe(true)
    expect(graphLinks(g({ recall: { cg: 9, hs: 9, grep: 0, saved: 0, run: false } })).ctx).toBe(false)
    expect(graphLinks(g({ builder: 'building' })).delegate).toBe(true)
    expect(graphLinks(g({ builder: 'done' })).delegate).toBe(false)
  })

  it('done? to brain lights for a finished builder or a failed member, and only a failure renames the label', () => {
    const done = graphLinks(g({ builder: 'done' }))
    expect(done.back).toBe(true)
    expect(done.backLabel).toBe('done? → brain')
    const fail = graphLinks(g({ council: { ui: 'idle', code: 'fail', run: 'idle' } }))
    expect(fail.back).toBe(true)
    expect(fail.backLabel).toBe('council fail → brain')
    expect(graphLinks(g({ builder: 'building' })).back).toBe(false)
  })

  it('call needs a member running; findings need a member finished', () => {
    const running = graphLinks(g({ council: { ui: 'running', code: 'idle', run: 'idle' } }))
    expect(running.call).toBe(true)
    expect(running.findingsAny).toBe(false)
    const fin = graphLinks(g({ council: { ui: 'pass', code: 'running', run: 'idle' } }))
    expect(fin.call).toBe(true)
    expect(fin.findings).toEqual({ ui: true, code: false, run: false })
    expect(fin.findingsAny).toBe(true)
  })

  it('load is never lit', () => {
    expect(graphLinks(g({ opus: 'awake', builder: 'building', recall: { cg: 1, hs: 1, grep: 1, saved: 1, run: true }, council: { ui: 'running', code: 'fail', run: 'pass' }, orch: 'done?', verdict: 'approve' })).load).toBe(false)
  })
})

describe('cards', () => {
  it('idle graph: every card is empty and dim', () => {
    for (const c of [orchestratorCard(null), brainCard(null), builderCard(null), councilCard(null, 'ui')]) expect(c).toMatchObject({ active: false, fill: 'empty', tone: 'dim', glyph: '' })
    expect(graphIsActive(g())).toBe(false)
  })

  it('a building builder sweeps; a done one is full with a tick', () => {
    expect(builderCard(g({ builder: 'building' }))).toMatchObject({ active: true, fill: 'run', text: 'building' })
    expect(builderCard(g({ builder: 'done' }))).toMatchObject({ active: false, fill: 'full', glyph: '✓' })
    expect(graphIsActive(g({ builder: 'building' }))).toBe(true)
  })

  it('a failed council member and a reject verdict are red crosses', () => {
    expect(councilCard(g({ council: { ui: 'idle', code: 'fail', run: 'idle' } }), 'code')).toMatchObject({ fill: 'full', tone: 'fail', glyph: '✖', text: 'fail' })
    expect(brainCard(g({ verdict: 'reject' }))).toMatchObject({ tone: 'fail', glyph: '✖', text: 'reject' })
    expect(brainCard(g({ verdict: 'approve' }))).toMatchObject({ tone: 'ok', glyph: '✓' })
  })

  it('the orchestrator shows what the state says', () => {
    expect(orchestratorCard(g({ orch: 'thinking' }))).toMatchObject({ active: true, fill: 'run', text: 'thinking' })
    expect(orchestratorCard(g({ orch: 'done?' }))).toMatchObject({ fill: 'full', text: 'done?' })
  })

  it('reads recall counts and the builder task from the state only', () => {
    expect(recallCounts(g({ recall: { cg: 3, hs: 2, grep: 5, saved: 1, run: false } }))).toEqual({ cg: '3 explores · 5 greps', hs: '2 recalls · 1 saved' })
    const sub = (name: string, status: 'running' | 'completed', doing: string | null) => ({ id: name + status, name, model: null, doing, startedAt: 1, endedAt: null, status })
    expect(builderTask(g({ subagents: [sub('builder', 'running', 'edit server.js'), sub('council-run', 'running', 'npm test')] }))).toBe('edit server.js')
    expect(builderTask(g({ subagents: [sub('builder', 'completed', 'old')] }))).toBeNull()
    expect(builderTask(null)).toBeNull()
  })
})

describe('freelancers', () => {
  const sub = (name: string, status: 'running' | 'completed' | 'failed' = 'running', n = 0) => ({ id: `${name}${n}`, name, model: 'haiku', doing: `job ${n}`, startedAt: n, endedAt: null, status })

  it('counts agents with no node (runner, Explore, custom) and skips builder, recall, reviewer and council', () => {
    const subs = ['runner', 'Explore', 'my-custom', 'builder', 'recall', 'reviewer', 'council-ui', 'council-code', 'council-run'].map((n) => sub(n))
    expect(freelancers(g({ subagents: subs })).map((a) => a.name)).toEqual(['runner', 'Explore', 'my-custom'])
  })

  it('is empty with no sub-agents or no graph, and lights no link or activity', () => {
    for (const graph of [null, g()]) {
      expect(freelancers(graph)).toEqual([])
      expect(freelancerView(graph)).toEqual({ count: 0, running: 0, rows: [], more: 0 })
      expect(graphLinks(graph).free).toBe(false)
    }
    expect(graphLinks(g({ subagents: [sub('builder')] })).free).toBe(false)
  })

  it('lights the link and the graph only while a freelancer runs', () => {
    const run = g({ subagents: [sub('runner')] })
    expect(graphLinks(run).free).toBe(true)
    expect(graphIsActive(run)).toBe(true)
    const done = g({ subagents: [sub('runner', 'completed'), sub('designer', 'failed', 1)] })
    expect(graphLinks(done).free).toBe(false)
    expect(graphIsActive(done)).toBe(false)
    expect(freelancerView(done).rows.map((r) => r.glyph).sort()).toEqual(['✓', '✖'])
  })

  it('shows running first, caps rows at 4 and counts the rest', () => {
    const subs = [sub('a', 'completed', 1), sub('b', 'completed', 2), sub('c', 'completed', 3), sub('d', 'completed', 4), sub('e', 'running', 5), sub('f', 'completed', 6)]
    const v = freelancerView(g({ subagents: subs }))
    expect(v.count).toBe(6)
    expect(v.running).toBe(1)
    expect(v.rows).toHaveLength(4)
    expect(v.rows[0]!.name).toBe('e')
    expect(v.more).toBe(2)
  })
})
