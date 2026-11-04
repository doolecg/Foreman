import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEventLine, type ClaudeEvent } from './claude-events'
import { applyGraphEvent, createGraphStore, emptyGraph, graphForProject, replyVerdict } from './orchestration-graph'

const SCRIPT = resolve(process.cwd(), 'scripts', 'op-event.mjs')
const SID = '11111111-2222-4333-8444-555555555555'
const CWD = 'E:\\REPOS\\PROGRAMS\\Demo'

let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

let clock = 1000
const ev = (name: string, payload: Record<string, unknown> = {}, sessionId = SID): ClaudeEvent => ({
  ts: (clock += 10),
  tile: 1,
  sessionId,
  name,
  payload: { hook_event_name: name, session_id: sessionId, cwd: CWD, ...payload },
})
const replay = (events: ClaudeEvent[]) => {
  const store = createGraphStore()
  for (const e of events) applyGraphEvent(store, e)
  return store
}
const agentCall = (type: string, description: string, model?: string) => ev('PreToolUse', { tool_name: 'Agent', tool_use_id: `u-${description}`, tool_input: { subagent_type: type, description, ...(model ? { model } : {}) } })
const start = (id: string, type: string) => ev('SubagentStart', { agent_id: id, agent_type: type })
const stop = (id: string, type: string, reply?: string) => ev('SubagentStop', { agent_id: id, agent_type: type, ...(reply === undefined ? {} : { last_assistant_message: reply }) })
const post = (tool: string, extra: Record<string, unknown> = {}) => ev('PostToolUse', { tool_name: tool, tool_input: {}, ...extra })

describe('replyVerdict', () => {
  it('reads the first word only', () => {
    expect(replyVerdict('Approve.')).toBe('approve')
    expect(replyVerdict('fail: 2 tests broke')).toBe('fail')
    expect(replyVerdict('`pass: 12 tests`')).toBe('pass')
    expect(replyVerdict('The plan is fine, approve it')).toBeNull()
    expect(replyVerdict(undefined)).toBeNull()
  })
})

describe('Orchestration graph derivation', () => {
  it('stays idle with no events and after events that carry no work', () => {
    const store = createGraphStore()
    expect(graphForProject(store, CWD)).toBeNull()
    applyGraphEvent(store, ev('SessionStart', { source: 'startup' }))
    applyGraphEvent(store, ev('Notification'))
    const g = store.graphs.get(SID)!
    expect(g).toEqual(emptyGraph(SID, CWD))
    expect(g.subagents).toEqual([])
    expect(g.orch).toBe('idle')
  })

  it('replays a full run into the expected state', () => {
    const store = replay([
      ev('SessionStart', { source: 'startup' }),
      ev('UserPromptSubmit'),
      post('mcp__hindsight__hindsight_search_knowledge_pages'),
      post('mcp__hindsight__hindsight_ingest_document'),
      agentCall('recall', 'find the hooks', 'claude-haiku-5-5'),
      start('a-recall', 'recall'),
      post('mcp__codegraph__codegraph_explore', { agent_id: 'a-recall' }),
      post('mcp__codegraph__codegraph_explore', { agent_id: 'a-recall' }),
      post('Grep', { agent_id: 'a-recall' }),
      stop('a-recall', 'recall', 'core/claude-events.ts:41'),
      agentCall('builder', 'build step 1'),
      start('a-build', 'builder'),
      post('Agent', { tool_response: { agentId: 'a-build', resolvedModel: 'claude-sonnet-5-5', status: 'completed' } }),
      stop('a-build', 'builder', 'DONE'),
      // two council members run in parallel
      agentCall('council-run', 'run tests'),
      agentCall('council-code', 'review code'),
      start('a-run', 'council-run'),
      start('a-code', 'council-code'),
      stop('a-code', 'council-code', 'note: unused import'),
      stop('a-run', 'council-run', 'fail: 3 tests failing'),
      agentCall('reviewer', 'gate'),
      start('a-rev', 'reviewer'),
      stop('a-rev', 'reviewer', 'reject: council-run failed'),
      ev('Stop'),
    ])
    const g = graphForProject(store, CWD)!
    expect(g).toMatchObject({
      sessionId: SID,
      project: CWD,
      orch: 'done?',
      builder: 'done',
      opus: 'idle',
      verdict: 'reject',
      calls: 1,
      council: { ui: 'idle', code: 'note', run: 'fail' },
      recall: { cg: 2, hs: 1, grep: 1, saved: 1, run: false },
    })
    expect(g.subagents.map((a) => [a.id, a.name, a.model, a.doing, a.status])).toEqual([
      ['a-recall', 'recall', 'claude-haiku-5-5', 'find the hooks', 'completed'],
      ['a-build', 'builder', 'claude-sonnet-5-5', 'build step 1', 'completed'],
      ['a-run', 'council-run', null, 'run tests', 'completed'],
      ['a-code', 'council-code', null, 'review code', 'completed'],
      ['a-rev', 'reviewer', null, 'gate', 'completed'],
    ])
    expect(g.subagents.every((a) => a.startedAt !== null && a.endedAt !== null && a.endedAt >= a.startedAt!)).toBe(true)
  })

  it('shows two parallel sub-agents as running until each one stops', () => {
    const store = replay([
      ev('SessionStart', { source: 'startup' }),
      start('p1', 'council-ui'),
      start('p2', 'council-code'),
    ])
    let g = store.graphs.get(SID)!
    expect(g.council).toEqual({ ui: 'running', code: 'running', run: 'idle' })
    expect(g.subagents.map((a) => a.status)).toEqual(['running', 'running'])
    applyGraphEvent(store, stop('p1', 'council-ui', 'pass'))
    g = store.graphs.get(SID)!
    expect(g.council).toEqual({ ui: 'pass', code: 'running', run: 'idle' })
    expect(g.subagents.map((a) => a.status)).toEqual(['completed', 'running'])
  })

  it('builds the builder state and does not invent a verdict', () => {
    const store = replay([ev('SessionStart', { source: 'startup' }), start('b', 'builder'), start('r', 'reviewer')])
    expect(store.graphs.get(SID)).toMatchObject({ builder: 'building', opus: 'awake', verdict: null })
    applyGraphEvent(store, stop('r', 'reviewer')) // payload without last_assistant_message
    expect(store.graphs.get(SID)).toMatchObject({ opus: 'idle', calls: 1, verdict: null })
    applyGraphEvent(store, stop('b', 'builder', 'DONE'))
    expect(store.graphs.get(SID)!.builder).toBe('done')
  })

  it('reads approve, and clears the verdict on the next prompt', () => {
    const store = replay([ev('SessionStart', { source: 'startup' }), start('r', 'reviewer'), stop('r', 'reviewer', 'approve')])
    expect(store.graphs.get(SID)!.verdict).toBe('approve')
    applyGraphEvent(store, ev('UserPromptSubmit'))
    expect(store.graphs.get(SID)).toMatchObject({ verdict: null, orch: 'thinking' })
  })

  it('keeps unknown sub-agent types in the list without touching the roles', () => {
    const store = replay([ev('SessionStart', { source: 'startup' }), start('x', 'Explore'), stop('x', 'Explore', 'fail: not a verdict here')])
    const g = store.graphs.get(SID)!
    expect(g.subagents).toHaveLength(1)
    expect({ ...g, subagents: [] }).toEqual({ ...emptyGraph(SID, CWD), subagents: [] })
  })

  it('marks a sub-agent failed from an errored Agent result', () => {
    const store = replay([start('f', 'builder'), post('Agent', { tool_response: { agentId: 'f', is_error: true } })])
    expect(store.graphs.get(SID)!.subagents[0]?.status).toBe('failed')
  })

  it('resets on a new session, keeps state separate per session, and finds the newest one for a project', () => {
    const OTHER = 'aaaaaaaa-2222-4333-8444-555555555555'
    const store = replay([ev('SessionStart', { source: 'startup' }), start('b', 'builder'), post('Grep')])
    applyGraphEvent(store, ev('SessionStart', { source: 'startup' }, OTHER))
    expect(store.graphs.get(OTHER)).toEqual(emptyGraph(OTHER, CWD))
    expect(store.graphs.get(SID)!.builder).toBe('building')
    expect(graphForProject(store, CWD)!.sessionId).toBe(OTHER)
    // the same session starting again wipes it, a compaction does not
    applyGraphEvent(store, ev('SessionStart', { source: 'compact' }))
    expect(store.graphs.get(SID)!.builder).toBe('building')
    applyGraphEvent(store, ev('SessionStart', { source: 'resume' }))
    expect(store.graphs.get(SID)).toEqual(emptyGraph(SID, CWD))
  })

  it('does not hand a refused Agent call description to the next sub-agent of that type', () => {
    const lost = (type: string, d: string) => ev('PreToolUse', { tool_name: 'Agent', tool_use_id: `lost-${d}`, tool_input: { subagent_type: type, description: d, model: 'claude-opus-5-5' } })
    const clears: Array<[string, () => ClaudeEvent]> = [
      ['UserPromptSubmit', () => ev('UserPromptSubmit')],
      ['Stop', () => ev('Stop')],
      ['SessionEnd', () => ev('SessionEnd')],
      ['PostToolUseFailure', () => ev('PostToolUseFailure', { tool_name: 'Agent', tool_use_id: 'lost-denied' })],
    ]
    for (const [name, clear] of clears) {
      const store = replay([lost('builder', 'denied'), clear(), agentCall('builder', 'real'), start('b', 'builder')])
      const a = store.graphs.get(SID)!.subagents[0]
      expect([name, a?.doing, a?.model]).toEqual([name, 'real', null])
    }
  })

  it('starts and stops a sub-agent that has no agent_id, keyed on agent_type', () => {
    const store = replay([ev('SubagentStart', { agent_type: 'council-code' })])
    let g = store.graphs.get(SID)!
    expect(g.council.code).toBe('running')
    expect(g.subagents).toMatchObject([{ name: 'council-code', status: 'running' }])
    applyGraphEvent(store, ev('SubagentStop', { agent_type: 'council-code', last_assistant_message: 'fail: x' }))
    g = store.graphs.get(SID)!
    expect(g.council.code).toBe('fail')
    expect(g.subagents[0]?.status).toBe('completed')
    expect(applyGraphEvent(store, ev('SubagentStart', {}))).toBe(false)
  })

  it('reports SessionStart as a change, and sets done? on Stop', () => {
    const store = createGraphStore()
    expect(applyGraphEvent(store, ev('SessionStart', { source: 'startup' }))).toBe(true)
    expect(applyGraphEvent(store, ev('SessionStart', { source: 'compact' }))).toBe(true)
    applyGraphEvent(store, ev('Stop'))
    expect(store.graphs.get(SID)!.orch).toBe('done?')
  })

  it('keeps the newest 50 finished sub-agents and every running one', () => {
    const events: ClaudeEvent[] = [start('run', 'builder')]
    for (let i = 0; i < 60; i++) events.push(start(`s${i}`, 'Explore'), stop(`s${i}`, 'Explore'))
    const g = replay(events).graphs.get(SID)!
    const ids = g.subagents.map((a) => a.id)
    expect(ids).toHaveLength(51)
    expect(ids[0]).toBe('run')
    expect(ids).toContain('s59')
    expect(ids).not.toContain('s9')
    expect(ids).toContain('s10')
  })

  it('drops old ended sessions past the retention limit, keeping live ones', () => {
    const store = createGraphStore()
    applyGraphEvent(store, ev('SessionStart', { source: 'startup' }, 'live'))
    for (let i = 0; i < 8; i++) {
      applyGraphEvent(store, ev('SessionStart', { source: 'startup' }, `end${i}`))
      applyGraphEvent(store, ev('SessionEnd', {}, `end${i}`))
    }
    const ids = [...store.graphs.keys()]
    expect(ids).toContain('live')
    expect(ids.filter((i) => i.startsWith('end'))).toEqual(['end3', 'end4', 'end5', 'end6', 'end7'])
    expect(store.pending.has('end0')).toBe(false)
  })

  it('caps the total number of sessions', () => {
    const store = createGraphStore()
    for (let i = 0; i < 60; i++) applyGraphEvent(store, ev('UserPromptSubmit', {}, `s${i}`))
    expect(store.graphs.size).toBe(50)
    expect(store.graphs.has('s0')).toBe(false)
    expect(store.graphs.has('s59')).toBe(true)
  })

  it('counts recall calls from the widened PostToolUse stream without calling a read "writing"', () => {
    const store = replay([ev('UserPromptSubmit'), post('Grep'), post('mcp__codegraph__codegraph_explore'), post('mcp__hindsight__hindsight_search_knowledge_pages'), post('Bash')])
    expect(store.graphs.get(SID)).toMatchObject({ orch: 'thinking', recall: { cg: 1, grep: 1, hs: 1 } })
  })

  it('drops an older never-started call of the same type when a newer one starts, without any clearing event', () => {
    const store = replay([agentCall('builder', 'denied', 'claude-opus-5-5'), agentCall('builder', 'real'), start('b', 'builder'), agentCall('recall', 'other')])
    expect(store.graphs.get(SID)!.subagents[0]).toMatchObject({ doing: 'real', model: null })
    expect(store.pending.get(SID)).toHaveLength(1)
  })

  it('SessionEnd leaves nothing running', () => {
    const store = replay([start('b', 'builder'), start('c', 'council-run'), start('r', 'recall'), ev('SessionEnd')])
    const g = store.graphs.get(SID)!
    expect(g).toMatchObject({ builder: 'idle', recall: { run: false }, council: { run: 'idle' } })
    expect(g.subagents.map((a) => a.status)).toEqual(['unknown', 'unknown', 'unknown'])
  })

  it('works from lines parsed the way the events folder reader parses them', () => {
    const line = JSON.stringify({ ts: 5, tile: '3', session_id: SID, hook_event_name: 'SubagentStart', agent_id: 'z', agent_type: 'council-ui', cwd: CWD })
    const store = replay([parseEventLine(line)!])
    expect(store.graphs.get(SID)!.council.ui).toBe('running')
  })
})

describe('op-event hook output', () => {
  // Every event type, as Claude Code sends it. Nothing may reach stdout, or it would enter the model's context.
  const events: Array<[string, Record<string, unknown>]> = [
    ['SessionStart', { source: 'startup' }],
    ['UserPromptSubmit', { prompt: 'hello' }],
    ['PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'builder', description: 'x' } }],
    ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['PostToolUse', { tool_name: 'Agent', tool_response: { agentId: 'a' } }],
    ['PostToolUse', { tool_name: 'mcp__codegraph__codegraph_explore', tool_response: {} }],
    ['PostToolUse', { tool_name: 'Grep', tool_response: {} }],
    ['PostToolUse', { tool_name: 'mcp__hindsight__hindsight_search_knowledge_pages', tool_response: {} }],
    ['PostToolUseFailure', { tool_name: 'Agent', tool_use_id: 'u1', error: 'denied' }],
    ['Notification', { message: 'hi' }],
    ['SubagentStart', { agent_id: 'a', agent_type: 'builder' }],
    ['SubagentStop', { agent_id: 'a', agent_type: 'builder', last_assistant_message: 'DONE' }],
    ['Stop', {}],
    ['SessionEnd', {}],
  ]

  for (const factory of [false, true]) {
    it(`prints nothing and exits 0 for every event type (factory mode ${factory ? 'on' : 'off'}, no helpers running)`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'op-event-orch-'))
      dirs.push(dir)
      for (const [name, extra] of events) {
        const res = spawnSync(process.execPath, [SCRIPT, 'hook', join(dir, 'events')], {
          input: JSON.stringify({ session_id: SID, hook_event_name: name, cwd: CWD, ...extra }),
          env: { PATH: process.env.PATH ?? '', FOREMAN_SOURCE: 'foreman', FOREMAN_TILE_ID: '7', ...(factory ? { FOREMAN_FACTORY: '1' } : {}) },
          encoding: 'utf8',
        })
        expect(res.status, name).toBe(0)
        expect(res.stdout, name).toBe('')
      }
      expect(readFileSync(join(dir, 'events', `${SID}.jsonl`), 'utf8').trim().split('\n')).toHaveLength(events.length)
    })
  }
})
