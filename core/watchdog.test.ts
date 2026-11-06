import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TicketRow, TicketStatus } from '../shared/tickets'
import type { ClaudeEvent } from './claude-events'
import { claimTicket, createTicket, setStatus, ticketsDir, updateTicket } from './tickets'
import {
  MAX_CALLS,
  Watchdog,
  WatchdogState,
  analyse,
  claimKey,
  matchBuffer,
  trackedKeys,
  waitKey,
  type WatchBuffer,
  type WatchCall,
  type WatchConfig,
  type WatchdogSettings,
} from './watchdog'

const MIN = 60_000
const T0 = 1_800_000_000_000
const cfg: WatchConfig = { stallMinutes: 10, loopRepeats: 4, waitMinutes: 30 }

const row = (id: string, status: TicketStatus = 'In Progress', worker = 'w1', deps: string[] = []): TicketRow => ({
  id,
  title: id,
  status,
  mode: 'Solo',
  dependsOn: deps.map((d) => ({ id: d, reason: '' })),
  worker: status === 'In Progress' ? worker : '',
  branch: '',
  worktree: '',
  verification: 'Pending',
  integration: 'Pending',
})
const call = (ts: number, tool = 'Bash', hash = 'h', extra: Partial<WatchCall> = {}): WatchCall => ({ ts, tool, hash, file: null, failHash: null, ...extra })
const buf = (calls: WatchCall[], lastActivityAt: number, extra: Partial<WatchBuffer> = {}): WatchBuffer => ({
  key: 's|w1',
  agentId: 'w1',
  agentType: 'builder',
  ended: false,
  lastActivityAt,
  calls,
  total: calls.length,
  pending: false,
  ...extra,
})
// Distinct inputs, so only the pattern under test shows.
const varied = (from: number, n: number): WatchCall[] => Array.from({ length: n }, (_, i) => call(from + i, 'Bash', `v${i}`))
const run = (tickets: TicketRow[], buffers: WatchBuffer[], now: number, firstSeen: Record<string, number> = { [claimKey({ id: 'T-001', worker: 'w1' })]: T0 }, c = cfg) =>
  analyse({ tickets, buffers, firstSeen }, now, c)
const kinds = (a: ReturnType<typeof analyse>) => a.map((x) => `${x.ticketId}:${x.kind}`)

describe('analyse', () => {
  it('raises nothing for a healthy worker', () => {
    const now = T0 + 5 * MIN
    expect(run([row('T-001')], [buf([...varied(T0 + 1, 10), call(now - 1000, 'Read', 'r', { file: 'a.ts' })], now - 1000)], now)).toEqual([])
    expect(run([], [], now)).toEqual([])
  })

  it('stalled: a claimed worker with no event for stallMinutes', () => {
    const last = T0 + 2 * MIN
    expect(run([row('T-001')], [buf([], last)], last + 9 * MIN)).toEqual([])
    const alerts = run([row('T-001')], [buf([], last)], last + 10 * MIN)
    expect(alerts).toMatchObject([{ ticketId: 'T-001', worker: 'w1', kind: 'stalled', since: last }])
    expect(alerts[0]?.detail).toContain('no event since')
  })

  it('stalled: says so when the worker has ended', () => {
    const last = T0 + MIN
    expect(run([row('T-001')], [buf([], last, { ended: true })], last + 11 * MIN)[0]?.detail).toContain('worker has ended')
  })

  it('silent: claimed, but no event at all since the claim', () => {
    expect(run([row('T-001')], [], T0 + 9 * MIN)).toEqual([])
    expect(run([row('T-001')], [], T0 + 10 * MIN)).toMatchObject([{ kind: 'silent', since: T0 }])
    // Events from before the claim do not count.
    expect(kinds(run([row('T-001')], [buf([], T0 - MIN)], T0 + 10 * MIN))).toEqual(['T-001:silent'])
  })

  it('looping: the same tool and input loopRepeats times in the recent calls', () => {
    const now = T0 + 3 * MIN
    const same = (n: number) => Array.from({ length: n }, (_, i) => call(T0 + 100 + i * 10, 'Bash', 'same'))
    expect(run([row('T-001')], [buf([...varied(T0 + 1, 6), ...same(3)], now - 1)], now)).toEqual([])
    const alerts = run([row('T-001')], [buf([...varied(T0 + 1, 6), ...same(4)], now - 1)], now)
    expect(alerts).toMatchObject([{ kind: 'looping', since: T0 + 100 }])
    expect(alerts[0]?.detail).toContain('Bash with the same input 4 times')
    // Same input on another tool is a different call.
    expect(run([row('T-001')], [buf([call(T0 + 1, 'Bash', 'x'), call(T0 + 2, 'Read', 'x'), call(T0 + 3, 'Bash', 'x'), call(T0 + 4, 'Read', 'x')], now - 1)], now)).toEqual([])
    // Old repeats fall out of the window.
    expect(run([row('T-001')], [buf([...same(4), ...varied(T0 + 500, 12)], now - 1)], now)).toEqual([])
  })

  it('loopRepeats from the settings is honoured', () => {
    const now = T0 + 3 * MIN
    const three = [call(T0 + 1, 'Bash', 'a'), call(T0 + 2, 'Bash', 'a'), call(T0 + 3, 'Bash', 'a')]
    expect(kinds(run([row('T-001')], [buf(three, now - 1)], now, undefined, { ...cfg, loopRepeats: 3 }))).toEqual(['T-001:looping'])
  })

  it('repeated-failure: the same error again and again with no other call between', () => {
    const now = T0 + 3 * MIN
    const fail = (ts: number, tool = 'Bash', failHash = 'e1') => call(ts, tool, `in${ts}`, { failHash })
    const calls = [call(T0 + 1, 'Read', 'r'), fail(T0 + 2), fail(T0 + 3), fail(T0 + 4), fail(T0 + 5)]
    const alerts = run([row('T-001')], [buf(calls, now - 1)], now)
    expect(alerts).toMatchObject([{ kind: 'repeated-failure', since: T0 + 2 }])
    expect(alerts[0]?.detail).toContain('Bash failed 4 times in a row')
    // A different tool call in between, a different error, or only three failures: nothing.
    expect(run([row('T-001')], [buf([fail(T0 + 2), fail(T0 + 3), call(T0 + 4, 'Read', 'r'), fail(T0 + 5), fail(T0 + 6)], now - 1)], now)).toEqual([])
    expect(run([row('T-001')], [buf([fail(T0 + 2), fail(T0 + 3), fail(T0 + 4, 'Bash', 'e2'), fail(T0 + 5), fail(T0 + 6)], now - 1)], now)).toEqual([])
    expect(run([row('T-001')], [buf([fail(T0 + 3), fail(T0 + 4), fail(T0 + 5)], now - 1)], now)).toEqual([])
    // A success after the failures ends the run.
    expect(run([row('T-001')], [buf([...calls, call(T0 + 6, 'Bash', 'ok')], now - 1)], now)).toEqual([])
  })

  it('revisiting: one file read or edited 6 times in the last 30 calls', () => {
    const now = T0 + 3 * MIN
    const touch = (n: number) => Array.from({ length: n }, (_, i) => call(T0 + 100 + i, i % 2 ? 'Edit' : 'Read', `f${i}`, { file: 'core/a.ts' }))
    expect(run([row('T-001')], [buf([...varied(T0 + 1, 10), ...touch(5)], now - 1)], now)).toEqual([])
    const alerts = run([row('T-001')], [buf([...varied(T0 + 1, 10), ...touch(6)], now - 1)], now)
    expect(alerts).toMatchObject([{ kind: 'revisiting', since: T0 + 100 }])
    expect(alerts[0]?.detail).toContain('core/a.ts')
    // Six touches spread over more than 30 calls are not a pattern.
    expect(run([row('T-001')], [buf([...touch(3), ...varied(T0 + 200, 30), ...touch(3)], now - 1)], now)).toEqual([])
  })

  it('ignores calls made before the claim', () => {
    const now = T0 + 3 * MIN
    const old = Array.from({ length: 6 }, (_, i) => call(T0 - 100 + i, 'Bash', 'same'))
    expect(run([row('T-001')], [buf(old, now - 1)], now)).toEqual([])
  })

  it('waiting: a Ready or Blocked ticket on unfinished dependencies for waitMinutes', () => {
    const tickets = [row('T-001', 'In Progress'), row('T-002', 'Ready', '', ['T-001']), row('T-003', 'Blocked', '', ['T-001'])]
    const firstSeen = { [claimKey({ id: 'T-001', worker: 'w1' })]: T0, [waitKey('T-002')]: T0, [waitKey('T-003')]: T0 + 5 * MIN }
    const b = [buf([], T0 + 30 * MIN - 1)]
    expect(run(tickets, b, T0 + 29 * MIN, firstSeen)).toEqual([])
    const first = run(tickets, [buf([], T0 + 30 * MIN - 1)], T0 + 30 * MIN, firstSeen)
    expect(first).toMatchObject([{ ticketId: 'T-002', kind: 'waiting', worker: '', since: T0 }])
    expect(first[0]?.detail).toContain('waiting on T-001 (In Progress)')
    expect(kinds(run(tickets, [buf([], T0 + 35 * MIN - 1)], T0 + 35 * MIN, firstSeen))).toEqual(['T-002:waiting', 'T-003:waiting'])
  })

  it('waiting: not for a ticket held back only by the worker cap or a file overlap', () => {
    const tickets = [row('T-001', 'Ready'), row('T-002', 'Ready')]
    expect(analyse({ tickets, buffers: [], firstSeen: {} }, T0 + 999 * MIN, { ...cfg, waitMinutes: 1 })).toEqual([])
  })

  it('alerts clear when the condition ends', () => {
    const last = T0 + MIN
    expect(kinds(run([row('T-001')], [buf([], last)], last + 11 * MIN))).toEqual(['T-001:stalled'])
    expect(run([row('T-001')], [buf([], last + 11 * MIN)], last + 11 * MIN)).toEqual([])
    expect(run([row('T-001', 'Review')], [buf([], last)], last + 11 * MIN)).toEqual([])
  })

  it('does not decide for two live helpers of one type', () => {
    const a = buf([], T0, { key: 's|a1', agentId: 'a1' })
    const b = buf([], T0, { key: 's|a2', agentId: 'a2' })
    expect(run([row('T-001', 'In Progress', 'builder:T-001')], [a, b], T0 + 60 * MIN, { [claimKey({ id: 'T-001', worker: 'builder:T-001' })]: T0 })).toEqual([])
  })

  it('is deterministic and sorted by ticket then kind', () => {
    const tickets = [row('T-002', 'In Progress', 'w2'), row('T-001')]
    const now = T0 + 60 * MIN
    const firstSeen = { [claimKey({ id: 'T-001', worker: 'w1' })]: T0, [claimKey({ id: 'T-002', worker: 'w2' })]: T0 }
    const a = analyse({ tickets, buffers: [], firstSeen }, now, cfg)
    expect(kinds(a)).toEqual(['T-001:silent', 'T-002:silent'])
    expect(analyse({ tickets: [...tickets].reverse(), buffers: [], firstSeen }, now, cfg)).toEqual(a)
  })
})

describe('matchBuffer and trackedKeys', () => {
  it('matches the agent_id first, then an unambiguous agent_type or type:label', () => {
    const a = buf([], 1, { key: 's|a1', agentId: 'a1', agentType: 'builder' })
    const r = buf([], 1, { key: 's|r1', agentId: 'r1', agentType: 'reviewer' })
    expect(matchBuffer('a1', [a, r])).toBe(a)
    expect(matchBuffer('builder', [a, r])).toBe(a)
    expect(matchBuffer('builder:T-001', [a, r])).toBe(a)
    expect(matchBuffer('builderx', [a, r])).toBeNull()
    expect(matchBuffer('nobody', [a, r])).toBeNull()
    const b2 = buf([], 1, { key: 's|a2', agentId: 'a2', agentType: 'builder' })
    expect(matchBuffer('builder:T-002', [a, b2])).toBe('ambiguous')
    expect(matchBuffer('a2', [a, b2])).toBe(b2)
    // A live one beats an ended one; with only ended ones the newest is used.
    expect(matchBuffer('builder', [buf([], 1, { key: 'x', agentId: 'x', ended: true }), b2])).toBe(b2)
    expect(matchBuffer('builder', [buf([], 1, { key: 'x', agentId: 'x', ended: true }), buf([], 9, { key: 'y', agentId: 'y', ended: true })])?.valueOf()).toMatchObject({ key: 'y' })
  })

  it('tracks claims and dependency waits only', () => {
    const tickets = [row('T-001'), row('T-002', 'Ready', '', ['T-001']), row('T-003', 'Ready'), row('T-004', 'Done')]
    expect(trackedKeys(tickets).sort()).toEqual([claimKey({ id: 'T-001', worker: 'w1' }), waitKey('T-002')].sort())
  })
})

const ev = (name: string, payload: Record<string, unknown>, ts = T0, sessionId = 's1'): ClaudeEvent => ({ ts, tile: 1, sessionId, name, payload })
const tool = (agent: string | null, name: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}, ts = T0, hook = 'PostToolUse') =>
  ev(hook, { cwd: 'C:\\proj', transcript_path: 'C:\\h\\p\\s1.jsonl', ...(agent ? { agent_id: agent, agent_type: 'builder' } : {}), tool_name: name, tool_input: input, ...extra }, ts)

describe('WatchdogState', () => {
  it('keeps the last 40 calls per worker and ignores events without an agent_id', () => {
    const st = new WatchdogState()
    for (let i = 0; i < 60; i++) st.record(tool('a1', 'Bash', { command: `c${i}` }, {}, T0 + i), T0)
    st.record(tool(null, 'Bash', { command: 'router' }), T0)
    const [b] = st.forProject('C:\\proj', () => null)
    expect(b?.calls).toHaveLength(MAX_CALLS)
    expect(b?.calls[0]?.ts).toBe(T0 + 20)
    expect(st.size).toBe(1)
  })

  it('records files for file tools, failures, and the sub-agent transcript heartbeat path', () => {
    const st = new WatchdogState()
    st.record(tool('a1', 'Edit', { file_path: 'C:\\proj\\A.ts' }), T0)
    st.record(tool('a1', 'Bash', { command: 'x' }, { error: 'boom' }, T0 + 1, 'PostToolUseFailure'), T0)
    st.record(tool('a1', 'Bash', { command: 'y' }, { tool_response: { is_error: true, stderr: 'boom' } }, T0 + 2), T0)
    const seen: string[] = []
    const [b] = st.forProject('c:/proj/', (p) => (seen.push(p), T0 + 99))
    expect(b?.calls.map((c) => [c.tool, c.file !== null, c.failHash !== null])).toEqual([['Edit', true, false], ['Bash', false, true], ['Bash', false, true]])
    expect(b?.calls[1]?.failHash).toBe(b?.calls[2]?.failHash)
    expect(seen[0]).toBe(join('C:\\h\\p', 's1', 'subagents', 'agent-a1.jsonl'))
    expect(b?.lastActivityAt).toBe(T0 + 99)
  })

  it('finds a helper in a worktree through its session folder, and ignores other projects', () => {
    const st = new WatchdogState()
    st.record(ev('SessionStart', { cwd: 'C:\\proj' }), T0)
    st.record(ev('PostToolUse', { cwd: 'D:\\wt\\T-001', agent_id: 'a1', agent_type: 'builder', tool_name: 'Bash', tool_input: {} }), T0)
    expect(st.forProject('C:\\proj', () => null)).toHaveLength(1)
    expect(st.forProject('C:\\other', () => null)).toHaveLength(0)
  })

  it('marks an ended helper, drops a session on SessionEnd and stays bounded', () => {
    const st = new WatchdogState()
    st.record(ev('SubagentStart', { cwd: 'C:\\proj', agent_id: 'a1', agent_type: 'builder' }), T0)
    st.record(ev('SubagentStop', { cwd: 'C:\\proj', agent_id: 'a1', agent_type: 'builder' }, T0 + 5), T0)
    expect(st.forProject('C:\\proj', () => null)[0]).toMatchObject({ ended: true, lastActivityAt: T0 + 5 })
    st.record(ev('SessionEnd', { cwd: 'C:\\proj' }), T0)
    expect(st.size).toBe(0)
    for (let i = 0; i < 100; i++) st.record(ev('SubagentStart', { cwd: 'C:\\proj', agent_id: `a${i}`, agent_type: 'builder' }, T0 + i), T0)
    expect(st.size).toBeLessThanOrEqual(64)
  })

  it('prunes workers whose ticket moved on, ended helpers and quiet ones, but not live ones', () => {
    const st = new WatchdogState()
    for (const id of ['a1', 'a2', 'a3', 'a4']) st.record(ev('SubagentStart', { cwd: 'C:\\proj', agent_id: id, agent_type: 'builder' }), T0)
    st.record(ev('SubagentStop', { cwd: 'C:\\proj', agent_id: 'a3', agent_type: 'builder' }), T0)
    st.mark('s1|a1', 'T-001')
    st.mark('s1|a2', 'T-002')
    st.prune(new Set(['s1|a1']), T0 + 1000)
    expect(st.forProject('C:\\proj', () => null).map((b) => b.agentId).sort()).toEqual(['a1', 'a4'])
    st.prune(new Set(), T0 + 7 * 3_600_000)
    expect(st.size).toBe(0)
  })
})

// ---------- the Watchdog with real ticket files and a fake clock and scheduler ----------

describe('Watchdog', () => {
  let root: string
  let project: string
  let now: number
  let timers: Array<{ id: number; ms: number; fn: () => void; live: boolean }>
  let settings: WatchdogSettings
  let folders: string[]
  const started: Watchdog[] = []
  const logs: string[] = []

  const scheduler = {
    every: (fn: () => void, ms: number) => {
      const t = { id: timers.length, ms, fn, live: true }
      timers.push(t)
      return t
    },
    cancel: (h: unknown) => void ((h as { live: boolean }).live = false),
  }
  const liveTimers = () => timers.filter((t) => t.live)
  const make = (extra: Partial<ConstructorParameters<typeof Watchdog>[0]> = {}): Watchdog => {
    const w = new Watchdog({ settings: () => settings, projects: () => folders, scheduler, now: () => now, mtime: () => null, log: (t) => logs.push(t), ...extra })
    started.push(w)
    return w
  }
  const alertsFile = () => join(ticketsDir(project), 'alerts.json')
  const readAlerts = () => JSON.parse(readFileSync(alertsFile(), 'utf8')) as Array<{ ticketId: string; kind: string }>
  const logOf = (id: string) => readFileSync(join(ticketsDir(project), id, 'log.md'), 'utf8').split('\n').filter((l) => l.includes('watchdog'))
  const claim = (worker = 'w1') => {
    const t = createTicket(project, { title: 'Work', rd: '', eval: '- [ ] done' })
    setStatus(project, t.id, 'Ready')
    claimTicket(project, t.id, worker)
    return t.id
  }
  const worker = (ts: number, name = 'SubagentStart', id = 'w1') => ev(name, { cwd: project, agent_id: id, agent_type: 'builder', transcript_path: join(root, 'h', 's1.jsonl') }, ts)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fm-watchdog-'))
    project = join(root, 'my project')
    mkdirSync(project)
    now = T0
    timers = []
    logs.length = 0
    folders = [project]
    settings = { watchdogEnabled: true, watchdogStallMinutes: 10, watchdogIntervalSeconds: 60, watchdogLoopRepeats: 4, watchdogWaitMinutes: 30 }
  })
  afterEach(() => {
    for (const w of started.splice(0)) w.stop()
    rmSync(root, { recursive: true, force: true })
  })

  it('runs one Watchdog per app: a second start does nothing, and stop is idempotent', () => {
    const a = make()
    const b = make()
    expect(a.start()).toBe(true)
    expect(a.start()).toBe(true)
    expect(b.start()).toBe(false)
    a.stop()
    a.stop()
    expect(b.start()).toBe(true)
  })

  it('has no timer when no worker holds a ticket', () => {
    const w = make()
    w.start()
    expect(w.timerActive).toBe(false)
    createTicket(project, { title: 'Draft', rd: '', eval: '- [ ] x' })
    w.evaluate()
    expect(timers).toHaveLength(0)
    w.feed(worker(now))
    expect(w.timerActive).toBe(false)
  })

  it('runs a single timer while a worker is claimed and clears it when the claim ends', () => {
    const w = make()
    w.start()
    const id = claim()
    w.evaluate()
    w.evaluate()
    expect(liveTimers()).toHaveLength(1)
    expect(liveTimers()[0]?.ms).toBe(60_000)
    setStatus(project, id, 'Review')
    liveTimers()[0]?.fn() // the tick
    expect(w.timerActive).toBe(false)
    expect(liveTimers()).toHaveLength(0)
  })

  it('a worker event finds a claim made after start, without polling in between', () => {
    const w = make()
    w.start()
    claim()
    expect(w.timerActive).toBe(false)
    w.feed(ev('SessionStart', { cwd: project }, now))
    now += 20_000
    w.feed(worker(now))
    expect(w.timerActive).toBe(true)
    expect(liveTimers()).toHaveLength(1)
  })

  it('stop clears the timer and later events do nothing', () => {
    const w = make()
    w.start()
    claim()
    w.evaluate()
    w.stop()
    expect(liveTimers()).toHaveLength(0)
    w.feed(worker(now))
    w.evaluate()
    expect(timers).toHaveLength(1)
  })

  it('re-arms when the interval setting changes and stops when disabled', () => {
    const w = make()
    w.start()
    claim()
    w.evaluate()
    settings = { ...settings, watchdogIntervalSeconds: 120 }
    w.evaluate()
    expect(liveTimers().map((t) => t.ms)).toEqual([120_000])
    settings = { ...settings, watchdogEnabled: false }
    w.evaluate()
    expect(liveTimers()).toHaveLength(0)
  })

  it('does nothing for a project with Orchestration off: no timer, no files', () => {
    folders = []
    const w = make()
    w.start()
    claim()
    now += 60 * MIN
    w.feed(worker(now))
    w.evaluate()
    expect(timers).toHaveLength(0)
    expect(existsSync(alertsFile())).toBe(false)
    expect(readdirSync(ticketsDir(project)).filter((n) => n.endsWith('.json'))).toEqual([])
  })

  it('withdraws its alerts when the project leaves Orchestration, then writes nothing more', () => {
    const w = make()
    w.start()
    const id = claim()
    w.evaluate()
    now += 11 * MIN
    w.evaluate()
    expect(readAlerts().map((a) => a.kind)).toEqual(['silent'])
    folders = []
    w.evaluate()
    expect(liveTimers()).toHaveLength(0)
    expect(readAlerts()).toEqual([])
    expect(logOf(id)).toHaveLength(2)
    expect(logOf(id)[1]).toContain('cleared: silent')
    // Later checks leave the file alone.
    writeFileSync(alertsFile(), 'MARKER')
    now += 20 * MIN
    w.evaluate()
    expect(readFileSync(alertsFile(), 'utf8')).toBe('MARKER')
  })

  it('withdraws its alerts when the setting is turned off, once', () => {
    const w = make()
    w.start()
    const id = claim()
    w.evaluate()
    now += 11 * MIN
    w.evaluate()
    settings = { ...settings, watchdogEnabled: false }
    w.evaluate()
    w.evaluate()
    expect(readAlerts()).toEqual([])
    expect(logOf(id)).toHaveLength(2)
    expect(liveTimers()).toHaveLength(0)
  })

  it('withdraws alerts left by an earlier run when it starts with the setting off', () => {
    const w1 = make()
    w1.start()
    const id = claim()
    w1.evaluate()
    now += 11 * MIN
    w1.evaluate()
    w1.stop() // clears its own alerts; then an older run's file is put back
    writeFileSync(alertsFile(), JSON.stringify([{ ticketId: id, worker: 'w1', kind: 'silent', since: 1, detail: 'old' }]))
    settings = { ...settings, watchdogEnabled: false }
    const w2 = make()
    w2.start()
    expect(readAlerts()).toEqual([])
  })

  it('stop writes an empty list over the alerts it wrote, and writes nothing when there was nothing', () => {
    const quiet = make()
    quiet.start()
    claim()
    quiet.evaluate()
    quiet.stop()
    expect(existsSync(alertsFile())).toBe(false)
    const w = make()
    w.start()
    now += 11 * MIN
    w.evaluate()
    expect(readAlerts()).toHaveLength(1)
    w.stop()
    expect(readAlerts()).toEqual([])
  })

  it('reports a silent worker, then a stalled one, writes alerts.json only when the set changes, and logs each once', () => {
    const w = make()
    w.start()
    const id = claim()
    w.evaluate()
    expect(existsSync(alertsFile())).toBe(false) // healthy: no file

    now += 10 * MIN
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ ticketId: id, kind: 'silent', worker: 'w1' }])
    expect(logOf(id)).toHaveLength(1)

    // Same alert again: the file is not rewritten (a marker would be lost) and nothing more is logged.
    writeFileSync(alertsFile(), 'MARKER')
    now += MIN
    w.evaluate()
    w.evaluate()
    expect(readFileSync(alertsFile(), 'utf8')).toBe('MARKER')
    expect(logOf(id)).toHaveLength(1)

    // The worker wakes up: the alert clears, once.
    w.feed(ev('SessionStart', { cwd: project }, now))
    w.feed(worker(now, 'PostToolUse'))
    w.evaluate()
    expect(readAlerts()).toEqual([])
    expect(logOf(id)).toHaveLength(2)
    expect(logOf(id)[1]).toContain('cleared: silent')
    w.evaluate()
    expect(logOf(id)).toHaveLength(2)

    // It goes quiet again: now it is stalled.
    now += 10 * MIN
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ kind: 'stalled' }])
    expect(logOf(id)).toHaveLength(3)
    expect(logOf(id)[2]).toContain('alert stalled (w1)')
  })

  it('writes alerts.json atomically: no temp file is left', () => {
    const w = make()
    w.start()
    claim()
    now += 11 * MIN
    w.evaluate()
    now += 11 * MIN
    w.evaluate()
    expect(readdirSync(ticketsDir(project)).filter((n) => n.includes('.tmp'))).toEqual([])
    expect(existsSync(alertsFile())).toBe(true)
  })

  it('detects a looping worker from fed events and matches the claim by agent_id', () => {
    const w = make()
    w.start()
    const id = claim('w1')
    w.evaluate()
    w.feed(ev('SessionStart', { cwd: project }, now))
    for (let i = 0; i < 5; i++) {
      now += 1000
      w.feed(ev('PostToolUse', { cwd: project, agent_id: 'w1', agent_type: 'builder', tool_name: 'Bash', tool_input: { command: 'npm test' } }, now))
    }
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ ticketId: id, kind: 'looping', worker: 'w1' }])
  })

  it('matches a claim made with the agent type when only one helper of that type runs', () => {
    const w = make()
    w.start()
    const id = claim('builder:T-001')
    w.evaluate()
    w.feed(ev('SessionStart', { cwd: project }, now))
    w.feed(worker(now + 1, 'SubagentStart', 'zz9'))
    now += 12 * MIN
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ ticketId: id, kind: 'stalled', worker: 'builder:T-001' }])
  })

  it('reports a ticket waiting on dependencies, checks slowly meanwhile, and clears it when the wait ends', () => {
    const w = make()
    w.start()
    const a = createTicket(project, { title: 'First', rd: '', eval: '- [ ] a' })
    const b = createTicket(project, { title: 'Second', rd: '', eval: '- [ ] b', dependsOn: [{ id: a.id, reason: '' }] })
    setStatus(project, a.id, 'Ready')
    setStatus(project, b.id, 'Ready')
    w.evaluate()
    // No worker holds a ticket, but a ticket waits: one slow timer keeps the wait alert fresh.
    expect(liveTimers().map((t) => t.ms)).toEqual([300_000])
    now += 29 * MIN
    w.evaluate()
    expect(existsSync(alertsFile())).toBe(false)
    now += 2 * MIN
    liveTimers()[0]?.fn()
    expect(readAlerts()).toMatchObject([{ ticketId: b.id, kind: 'waiting' }])
    updateTicket(project, b.id, { dependsOn: [] })
    liveTimers()[0]?.fn()
    expect(readAlerts()).toEqual([])
    expect(logOf(b.id)).toHaveLength(2)
    expect(w.timerActive).toBe(false)
  })

  it('does not let a failing project stop the others', () => {
    const bad = join(root, 'bad')
    mkdirSync(bad)
    writeFileSync(join(bad, '.foreman'), 'a file where a folder should be')
    folders = [bad, project]
    const w = make()
    w.start()
    claim()
    expect(() => w.evaluate()).not.toThrow()
    expect(w.timerActive).toBe(true)
  })

  const bash = (command: string, ts: number, extra: Record<string, unknown> = {}, name = 'PostToolUse') =>
    ev(name, { cwd: project, agent_id: 'w1', agent_type: 'builder', tool_name: 'Bash', tool_input: { command }, ...extra }, ts)
  const startLoopWatch = () => {
    const w = make()
    w.start()
    const id = claim('w1')
    w.evaluate()
    w.feed(ev('SessionStart', { cwd: project }, now))
    return { w, id }
  }
  const say = (w: Watchdog, command: string, n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 1000
      w.feed(bash(command, now))
    }
  }

  it('keeps since and the file steady while the same looping alert stays active', () => {
    const { w } = startLoopWatch()
    say(w, 'npm test', 4)
    w.evaluate()
    expect(readAlerts().map((a) => a.kind)).toEqual(['looping'])
    const before = readFileSync(alertsFile(), 'utf8')
    // More of the same, until the window has slid right past the first call: the count in the text and the raw since both move.
    say(w, 'npm test', 15)
    w.evaluate()
    expect(readFileSync(alertsFile(), 'utf8')).toBe(before)
    writeFileSync(alertsFile(), 'MARKER')
    say(w, 'npm test', 3)
    w.evaluate()
    expect(readFileSync(alertsFile(), 'utf8')).toBe('MARKER')
    // A change in the kind of alert is still written.
    now += 30 * MIN
    w.evaluate()
    expect(readFileSync(alertsFile(), 'utf8')).not.toBe('MARKER')
  })

  it('holds a looping alert until loopRepeats more calls have been clean', () => {
    const { w, id } = startLoopWatch()
    say(w, 'npm test', 4)
    w.evaluate()
    expect(readAlerts().map((a) => a.kind)).toEqual(['looping'])
    for (let i = 0; i < 9; i++) say(w, `step ${i}`) // the window (12 calls) no longer holds 4 equal calls
    w.evaluate()
    expect(readAlerts().map((a) => a.kind)).toEqual(['looping']) // held, not flapped
    say(w, 'a1', 3)
    w.evaluate()
    expect(readAlerts().map((a) => a.kind)).toEqual(['looping'])
    say(w, 'a2')
    w.evaluate()
    expect(readAlerts()).toEqual([])
    expect(logOf(id)).toHaveLength(2)
  })

  it('also lets a held alert go after stallMinutes/2 without more calls', () => {
    const { w } = startLoopWatch()
    say(w, 'npm test', 4)
    w.evaluate()
    for (let i = 0; i < 9; i++) say(w, `step ${i}`)
    w.evaluate()
    expect(readAlerts()).toHaveLength(1)
    now += 4 * MIN
    w.feed(bash('keep alive', now))
    w.evaluate()
    expect(readAlerts()).toHaveLength(1)
    now += 2 * MIN
    w.feed(bash('keep alive 2', now))
    w.evaluate()
    expect(readAlerts()).toEqual([])
  })

  it('a held alert returns to active when the pattern comes back, without a new log line', () => {
    const { w, id } = startLoopWatch()
    say(w, 'npm test', 4)
    w.evaluate()
    for (let i = 0; i < 9; i++) say(w, `step ${i}`)
    w.evaluate()
    say(w, 'npm test', 4)
    w.evaluate()
    expect(readAlerts().map((a) => a.kind)).toEqual(['looping'])
    expect(logOf(id)).toHaveLength(1)
  })

  it('logs a write failure once until a write works', () => {
    const w = make()
    w.start()
    claim()
    w.evaluate()
    mkdirSync(alertsFile()) // a folder where the file belongs: the rename fails
    now += 11 * MIN
    w.evaluate()
    now += MIN
    w.evaluate()
    w.evaluate()
    expect(logs.filter((l) => l.includes('could not write alerts.json'))).toHaveLength(1)
    rmSync(alertsFile(), { recursive: true })
    w.evaluate()
    expect(readAlerts()).toHaveLength(1)
    expect(logs.filter((l) => l.includes('could not write'))).toHaveLength(1)
  })

  it('never throws into the caller and warns once when its own reads fail', () => {
    let broken = true
    const w = make({
      projects: () => {
        if (broken) throw new Error('crews unavailable')
        return folders
      },
    })
    expect(() => w.start()).not.toThrow()
    for (let i = 0; i < 3; i++) {
      expect(() => w.feed(ev('SessionStart', { cwd: project }, now))).not.toThrow()
      expect(() => w.evaluate()).not.toThrow()
    }
    expect(logs.filter((l) => l.includes('crews unavailable'))).toHaveLength(2) // one for feed, one for evaluate
    broken = false
    claim()
    w.evaluate()
    expect(w.timerActive).toBe(true)
    const bad = make({ settings: () => { throw new Error('settings unavailable') } })
    expect(() => bad.evaluate()).not.toThrow()
    expect(() => bad.stop()).not.toThrow()
  })

  it('allows a pending helper call three times as long, and says when a stall may be one long tool call', () => {
    const { w } = startLoopWatch()
    now += 1000
    w.feed(ev('PreToolUse', { cwd: project, agent_id: 'w1', agent_type: 'builder', tool_name: 'Agent', tool_input: {} }, now))
    now += 11 * MIN
    w.evaluate()
    expect(existsSync(alertsFile())).toBe(false) // a call is in flight: not yet
    now += 20 * MIN
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ kind: 'stalled', detail: expect.stringContaining('waiting on a helper call') }])
    now += 1000
    w.feed(ev('PostToolUse', { cwd: project, agent_id: 'w1', agent_type: 'builder', tool_name: 'Agent', tool_input: {} }, now))
    w.evaluate()
    expect(readAlerts()).toEqual([])
    now += 11 * MIN
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ kind: 'stalled', detail: expect.stringContaining('may be one long tool call') }])
  })

  const stale = [{ ticketId: 'T-001', worker: 'w1', kind: 'stalled', since: 1, detail: 'old' }]

  it('stop withdraws a stale alerts.json for every Orchestration project, even one it had not looked at', () => {
    folders = []
    const w = make()
    w.start()
    folders = [project]
    mkdirSync(ticketsDir(project), { recursive: true })
    writeFileSync(alertsFile(), JSON.stringify(stale))
    w.stop()
    expect(readAlerts()).toEqual([])
  })

  it('writes an empty list when a board cannot be read', () => {
    mkdirSync(join(ticketsDir(project), 'board.md'), { recursive: true }) // a folder where the board file belongs
    writeFileSync(alertsFile(), JSON.stringify(stale))
    const w = make()
    w.start()
    expect(readAlerts()).toEqual([])
    expect(logs.filter((l) => l.includes('could not check'))).toHaveLength(1)
    w.evaluate()
    expect(logs.filter((l) => l.includes('could not check'))).toHaveLength(1)
  })

  it('logs a recurring event error again after a good event in between', () => {
    let broken = true
    const w = make({
      projects: () => {
        if (broken) throw new Error('crews unavailable')
        return folders
      },
    })
    w.start()
    const start = ev('SessionStart', { cwd: project }, now)
    w.feed(start)
    w.feed(start)
    broken = false
    w.feed(start)
    broken = true
    // The project list is cached for a few seconds; move past that so the next event reads it again.
    now += 10_000
    w.feed(start)
    expect(logs.filter((l) => l.includes('could not read an event'))).toHaveLength(2)
  })

  it('keeps the helper-call allowance while a Read or Bash is made, until that call itself ends', () => {
    const { w } = startLoopWatch()
    now += 1000
    w.feed(ev('PreToolUse', { cwd: project, agent_id: 'w1', agent_type: 'builder', tool_name: 'Agent', tool_use_id: 'u1', tool_input: {} }, now))
    now += 1000
    w.feed(bash('ls', now))
    now += 11 * MIN
    w.evaluate()
    expect(existsSync(alertsFile())).toBe(false) // still waiting on the Agent call, 3x allowance
    w.feed(ev('PostToolUse', { cwd: project, agent_id: 'w1', agent_type: 'builder', tool_name: 'Agent', tool_use_id: 'u1', tool_input: {} }, now))
    now += 11 * MIN
    w.evaluate()
    expect(readAlerts()).toMatchObject([{ kind: 'stalled', detail: expect.stringContaining('may be one long tool call') }])
  })

  it('matches the pending call by tool name when there is no tool_use_id', () => {
    const st = new WatchdogState()
    const e = (name: string, tool: string, ts: number) => ev(name, { cwd: 'C:/p', agent_id: 'a1', agent_type: 'builder', tool_name: tool, tool_input: {} }, ts)
    st.record(e('PreToolUse', 'Agent', T0), T0)
    st.record(e('PostToolUse', 'Bash', T0 + 1), T0)
    expect(st.forProject('C:/p', () => null)[0]?.pending).toBe(true)
    st.record(e('PostToolUseFailure', 'Agent', T0 + 2), T0)
    expect(st.forProject('C:/p', () => null)[0]?.pending).toBe(false)
  })
})
