import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/settings'
import type { TicketRow } from '../shared/tickets'
import { sameFolder } from './claude-agents'
import type { ClaudeEvent } from './claude-events'
import { planNext } from './scheduler'
import { alertsPath, listTickets, logEvent, readAlerts, ticketsDir, writeAtomic } from './tickets'

// Watchdog: spots ticket workers that stalled, loop or wait too long, and reports it to the Router in
// <project>/.foreman/tickets/alerts.json. It only reports. No model calls: hook events and the clock are all it reads.
// analyse() is pure; WatchdogState keeps the recent calls; Watchdog owns the one timer and the files.

export type AlertKind = 'stalled' | 'silent' | 'looping' | 'repeated-failure' | 'revisiting' | 'waiting'
// context-high is not built: no event, status line or graph field carries a context percentage per sub-agent.

export interface WatchAlert {
  ticketId: string
  worker: string
  kind: AlertKind
  since: number
  detail: string
}

export interface WatchConfig {
  stallMinutes: number
  loopRepeats: number
  waitMinutes: number
}

// One finished tool call. `file` is set for the file tools, `failHash` only when the call failed.
export interface WatchCall {
  ts: number
  tool: string
  hash: string
  file: string | null
  failHash: string | null
}

export interface WatchBuffer {
  key: string
  agentId: string
  agentType: string | null
  ended: boolean
  // Newest sign of life: the last event, or the sub-agent transcript's modified time when that is newer.
  lastActivityAt: number
  calls: readonly WatchCall[]
  // Calls ever recorded for this worker (calls itself keeps only the last MAX_CALLS).
  total: number
  // A tool call (one the hooks report a PreToolUse for) has started and not finished.
  pending: boolean
}

export interface WatchInput {
  tickets: readonly TicketRow[]
  buffers: readonly WatchBuffer[]
  // When the Watchdog first saw each claim (claimKey) or wait (waitKey). A missing key means "just now".
  firstSeen: Readonly<Record<string, number>>
}

export const MAX_CALLS = 40
const REVISIT_WINDOW = 30
const REVISIT_COUNT = 6
const MAX_BUFFERS = 64
const STALE_BUFFER_MS = 6 * 3_600_000
// While no timer runs, an event may trigger one board check at most this often.
const PROBE_MS = 15_000
const PROJECTS_TTL_MS = 5_000
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const KIND_ORDER: AlertKind[] = ['stalled', 'silent', 'looping', 'repeated-failure', 'revisiting', 'waiting']

const MINUTE = 60_000
export const claimKey = (t: Pick<TicketRow, 'id' | 'worker'>): string => `claim|${t.id}|${t.worker}`
export const waitKey = (id: string): string => `wait|${id}`

// Small, stable string hash (FNV-1a): enough to tell inputs and error texts apart without keeping them.
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

// Tickets that wait on dependencies: a Ready one by the scheduler's own reason, a Blocked one when a dependency is unfinished.
function dependencyWaits(tickets: readonly TicketRow[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const w of planNext(tickets, { maxWorkers: 8 }).waiting) if (/^(waiting on|blocked by failed) /.test(w.reason)) out.set(w.id, w.reason)
  const byId = new Map(tickets.map((t) => [t.id, t]))
  for (const t of tickets) {
    if (t.status !== 'Blocked') continue
    const pending = t.dependsOn.filter((d) => byId.get(d.id)?.status !== 'Done')
    if (pending.length) out.set(t.id, `waiting on ${pending.map((d) => `${d.id} (${byId.get(d.id)?.status ?? 'missing'})`).join(', ')}`)
  }
  return out
}

// The keys analyse() reads from firstSeen for these tickets; the caller stamps new ones with the time and drops the rest.
export function trackedKeys(tickets: readonly TicketRow[]): string[] {
  return [...tickets.filter((t) => t.status === 'In Progress' && t.worker).map(claimKey), ...[...dependencyWaits(tickets).keys()].map(waitKey)]
}

// A ticket's worker id is its sub-agent's agent_id when known, else "<agent_type>" or "<agent_type>:<label>".
// The agent_id wins. A type match counts only when it is unambiguous (one live sub-agent of that type, or none live and one ended).
export function matchBuffer(worker: string, buffers: readonly WatchBuffer[]): WatchBuffer | 'ambiguous' | null {
  const exact = buffers.find((b) => b.agentId === worker)
  if (exact) return exact
  const ofType = buffers.filter((b) => b.agentType !== null && (worker === b.agentType || worker.startsWith(`${b.agentType}:`)))
  const live = ofType.filter((b) => !b.ended)
  const pool = live.length ? live : ofType.length ? [ofType.reduce((a, b) => (b.lastActivityAt > a.lastActivityAt ? b : a))] : []
  return pool.length === 0 ? null : pool.length === 1 ? (pool[0] ?? null) : 'ambiguous'
}

// The value seen most often, with how often (first one wins a tie, so the result is the same every time).
function mostOften<T>(items: readonly T[], key: (item: T) => string): { item: T; count: number } | null {
  const counts = new Map<string, { item: T; count: number }>()
  let best: { item: T; count: number } | null = null
  for (const item of items) {
    const k = key(item)
    const entry = counts.get(k) ?? { item, count: 0 }
    entry.count++
    counts.set(k, entry)
    if (!best || entry.count > best.count) best = entry
  }
  return best
}

const iso = (ms: number): string => new Date(ms).toISOString()

export function analyse(input: WatchInput, now: number, cfg: WatchConfig): WatchAlert[] {
  const alerts: WatchAlert[] = []
  const stallMs = cfg.stallMinutes * MINUTE
  const loopWindow = Math.min(MAX_CALLS, cfg.loopRepeats * 3)

  for (const t of input.tickets) {
    if (t.status !== 'In Progress' || !t.worker) continue
    const add = (kind: AlertKind, since: number, detail: string): void => void alerts.push({ ticketId: t.id, worker: t.worker, kind, since, detail })
    const claimedAt = input.firstSeen[claimKey(t)] ?? now
    const buf = matchBuffer(t.worker, input.buffers)
    // Two live helpers of one type and no agent_id to tell them apart: nothing can be said about either.
    if (buf === 'ambiguous') continue
    if (!buf || buf.lastActivityAt < claimedAt) {
      if (now - claimedAt >= stallMs) add('silent', claimedAt, `no event from the worker since it claimed the ticket at ${iso(claimedAt)}`)
      continue
    }
    // A helper call in flight (Agent or Task) can run for a long time: allow three times as long. Other tools send no PreToolUse,
    // so a long Bash or Read cannot be told from a hang.
    if (now - buf.lastActivityAt >= (buf.pending ? stallMs * 3 : stallMs)) {
      const why = buf.ended ? 'worker has ended' : buf.pending ? 'waiting on a helper call' : 'no event'
      add('stalled', buf.lastActivityAt, `${why} since ${iso(buf.lastActivityAt)}${buf.ended || buf.pending ? '' : ' (may be one long tool call)'}`)
    }

    // Calls made before the claim belong to earlier work.
    const calls = buf.calls.filter((c) => c.ts >= claimedAt)
    const recent = calls.slice(-loopWindow)
    const loop = mostOften(recent, (c) => `${c.tool}|${c.hash}`)
    if (loop && loop.count >= cfg.loopRepeats) {
      const first = recent.find((c) => c.tool === loop.item.tool && c.hash === loop.item.hash)!
      add('looping', first.ts, `${loop.item.tool} with the same input ${loop.count} times in the last ${recent.length} calls`)
    }

    let run = 0
    const last = calls[calls.length - 1]
    for (let i = calls.length - 1; i >= 0 && last?.failHash && calls[i]?.failHash === last.failHash && calls[i]?.tool === last.tool; i--) run++
    if (last && run >= cfg.loopRepeats) add('repeated-failure', calls[calls.length - run]?.ts ?? last.ts, `${last.tool} failed ${run} times in a row with the same error`)

    const files = calls.slice(-REVISIT_WINDOW).filter((c) => c.file !== null)
    const revisit = mostOften(files, (c) => c.file!)
    if (revisit && revisit.count >= REVISIT_COUNT) {
      const first = files.find((c) => c.file === revisit.item.file)!
      add('revisiting', first.ts, `${revisit.item.file} read or edited ${revisit.count} times in the last ${Math.min(calls.length, REVISIT_WINDOW)} calls`)
    }
  }

  const byId = new Map(input.tickets.map((t) => [t.id, t]))
  for (const [id, reason] of dependencyWaits(input.tickets)) {
    const since = input.firstSeen[waitKey(id)] ?? now
    if (now - since >= cfg.waitMinutes * MINUTE) alerts.push({ ticketId: id, worker: byId.get(id)?.worker ?? '', kind: 'waiting', since, detail: `${reason}, since ${iso(since)}` })
  }

  return alerts.sort(compareAlerts)
}

const compareAlerts = (a: WatchAlert, b: WatchAlert): number => a.ticketId.localeCompare(b.ticketId) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)

// ---------- keeping alerts steady between checks ----------

export interface HeldAlert {
  alert: WatchAlert
  // Set while a looping or revisiting alert is being held after its pattern left the window.
  clean?: { total: number | null; at: number }
}

const alertKey = (a: Pick<WatchAlert, 'ticketId' | 'kind'>): string => `${a.ticketId}|${a.kind}`
// The detail without its numbers: a count or a time changing is not a change worth a rewrite.
const bucket = (a: WatchAlert): string => a.detail.replace(/\d+/g, '#')
const HOLD_KINDS = new Set<AlertKind>(['looping', 'revisiting'])

export interface SettleContext {
  now: number
  cfg: WatchConfig
  // Calls ever recorded, by ticket id, for the worker that holds it.
  totals: ReadonlyMap<string, number>
  // Worker by ticket id, for the tickets In Progress.
  holders: ReadonlyMap<string, string>
}

// Turns this check's raw alerts into the steady set: an alert already active keeps its `since` (and its text, while the text
// only changes in numbers); a looping or revisiting alert whose pattern slid out of the window is held until the worker has
// made loopRepeats more calls or stallMinutes/2 has passed, whichever is first, so a borderline pattern does not flap.
export function settle(prev: ReadonlyMap<string, HeldAlert>, raw: readonly WatchAlert[], ctx: SettleContext): Map<string, HeldAlert> {
  const out = new Map<string, HeldAlert>()
  for (const a of raw) {
    const old = prev.get(alertKey(a))?.alert
    const same = old !== undefined && old.worker === a.worker
    out.set(alertKey(a), { alert: same ? (bucket(old) === bucket(a) ? old : { ...a, since: old.since }) : a })
  }
  for (const [k, h] of prev) {
    if (out.has(k) || !HOLD_KINDS.has(h.alert.kind) || ctx.holders.get(h.alert.ticketId) !== h.alert.worker) continue
    const total = ctx.totals.get(h.alert.ticketId) ?? null
    const clean = h.clean ?? { total, at: ctx.now }
    const calls = total !== null && clean.total !== null ? total - clean.total : 0
    if (calls >= ctx.cfg.loopRepeats || ctx.now - clean.at >= (ctx.cfg.stallMinutes * MINUTE) / 2) continue
    out.set(k, { alert: h.alert, clean })
  }
  return out
}

// ---------- recent calls per worker ----------

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const fileKey = (p: string): string => {
  const d = p.replace(/\\/g, '/')
  return process.platform === 'win32' ? d.toLowerCase() : d
}

interface Held extends Omit<WatchBuffer, 'lastActivityAt' | 'pending'> {
  sessionId: string
  cwd: string | null
  transcript: string | null
  lastEventAt: number
  total: number
  // PreToolUse calls without their Post yet.
  pending: Array<{ id: string | null; tool: string }>
  // The ticket this worker last matched, so the buffer goes when that ticket moves on.
  ticketId?: string
}

// Bounded by MAX_CALLS per worker and MAX_BUFFERS overall. record() is O(1) in the size of the event.
export class WatchdogState {
  private readonly held = new Map<string, Held>()
  private readonly sessionCwd = new Map<string, string>()

  // Where an event's session works (the Router's folder), falling back to the event's own cwd. A helper may run in a worktree.
  cwdFor(sessionId: string, cwd: string | undefined): string | null {
    return this.sessionCwd.get(sessionId) ?? cwd ?? null
  }

  record(ev: ClaudeEvent, now: number): void {
    const p = ev.payload
    const cwd = str(p.cwd)
    if (ev.name === 'SessionEnd') {
      this.dropSession(ev.sessionId)
      return
    }
    const agentId = str(p.agent_id)
    if (!agentId) {
      // The Router's own event: tells where the session works.
      if (cwd) {
        this.sessionCwd.delete(ev.sessionId)
        this.sessionCwd.set(ev.sessionId, cwd)
        if (this.sessionCwd.size > MAX_BUFFERS) this.sessionCwd.delete(this.sessionCwd.keys().next().value as string)
      }
      return
    }
    const ts = ev.ts || now
    const key = `${ev.sessionId}|${agentId}`
    let b = this.held.get(key)
    if (!b) {
      const tp = str(p.transcript_path)
      b = {
        key,
        agentId,
        agentType: str(p.agent_type) ?? null,
        ended: false,
        calls: [],
        sessionId: ev.sessionId,
        cwd: cwd ?? null,
        transcript: tp ? join(dirname(tp), ev.sessionId, 'subagents', `agent-${agentId}.jsonl`) : null,
        lastEventAt: ts,
        total: 0,
        pending: [],
      }
      this.held.set(key, b)
      if (this.held.size > MAX_BUFFERS) this.dropOldest()
    }
    b.lastEventAt = Math.max(b.lastEventAt, ts)
    b.agentType ??= str(p.agent_type) ?? null
    if (ev.name === 'SubagentStop') {
      b.ended = true
      b.pending = []
    }
    const tool = str(p.tool_name)
    const useId = str(p.tool_use_id) ?? null
    if (ev.name === 'PreToolUse' && tool) b.pending.push({ id: useId, tool })
    if (ev.name !== 'PostToolUse' && ev.name !== 'PostToolUseFailure') return
    // Only the Post of the pending call itself ends it (same tool_use_id, else the same tool): a Read or Bash made meanwhile does not.
    const at = b.pending.findIndex((c) => (useId !== null && c.id !== null ? c.id === useId : c.tool === tool))
    if (at >= 0) b.pending.splice(at, 1)
    if (!tool) return
    const input = obj(p.tool_input)
    const file = FILE_TOOLS.has(tool) ? str(input.file_path) ?? str(input.notebook_path) ?? str(input.path) : undefined
    const response = obj(p.tool_response)
    const failed = ev.name === 'PostToolUseFailure' || response.is_error === true
    const failText = str(p.error) ?? str(response.error) ?? str(response.stderr) ?? 'failed'
    const mutable = b.calls as WatchCall[]
    mutable.push({
      ts,
      tool,
      hash: hashText(JSON.stringify(input).slice(0, 4000)),
      file: file ? fileKey(file) : null,
      failHash: failed ? hashText(failText.slice(0, 1000)) : null,
    })
    if (mutable.length > MAX_CALLS) mutable.shift()
    b.total++
  }

  private dropOldest(): void {
    let oldest: Held | null = null
    for (const b of this.held.values()) if (!oldest || b.lastEventAt < oldest.lastEventAt) oldest = b
    if (oldest) this.held.delete(oldest.key)
  }

  dropSession(sessionId: string): void {
    for (const [k, b] of this.held) if (b.sessionId === sessionId) this.held.delete(k)
    this.sessionCwd.delete(sessionId)
  }

  // The buffers of helpers that work for `folder`. `mtime` reads the sub-agent transcript's modified time (a worker that only
  // edits and runs commands sends few hook events, but its transcript keeps growing).
  forProject(folder: string, mtime: (path: string) => number | null): WatchBuffer[] {
    const out: WatchBuffer[] = []
    for (const b of this.held.values()) {
      const where = this.cwdFor(b.sessionId, b.cwd ?? undefined)
      if (!where || !sameFolder(where, folder)) continue
      const beat = !b.ended && b.transcript ? mtime(b.transcript) : null
      out.push({ key: b.key, agentId: b.agentId, agentType: b.agentType, ended: b.ended, calls: b.calls, total: b.total, pending: b.pending.length > 0, lastActivityAt: Math.max(b.lastEventAt, beat ?? 0) })
    }
    return out
  }

  mark(key: string, ticketId: string): void {
    const b = this.held.get(key)
    if (b) b.ticketId = ticketId
  }

  // Drops workers whose ticket moved on (`live` holds the buffers matched to an In Progress ticket this round), ended helpers
  // no ticket holds, and anything quiet for hours.
  prune(live: ReadonlySet<string>, now: number): void {
    for (const [k, b] of this.held) {
      if (live.has(k)) continue
      if (b.ticketId !== undefined || b.ended || now - b.lastEventAt > STALE_BUFFER_MS) this.held.delete(k)
    }
  }

  get size(): number {
    return this.held.size
  }

  clear(): void {
    this.held.clear()
    this.sessionCwd.clear()
  }
}

// ---------- the Watchdog ----------

export type WatchdogSettings = Pick<Settings, 'watchdogEnabled' | 'watchdogStallMinutes' | 'watchdogIntervalSeconds' | 'watchdogLoopRepeats' | 'watchdogWaitMinutes'>

export interface WatchdogDeps {
  settings: () => WatchdogSettings
  // Folders of the projects with Orchestration on. Nothing is read or written for any other folder.
  projects: () => string[]
  scheduler: { every(fn: () => void, ms: number): unknown; cancel(handle: unknown): void }
  now?: () => number
  mtime?: (path: string) => number | null
  log?: (text: string) => void
}

interface ProjectState {
  firstSeen: Record<string, number>
  // Alerts after the last check by `ticketId|kind`, and the JSON of what alerts.json holds.
  active: Map<string, HeldAlert>
  written: string
}

const realMtime = (path: string): number | null => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

const isAlert = (v: unknown): v is WatchAlert => {
  const o = obj(v)
  return typeof o.ticketId === 'string' && typeof o.kind === 'string' && typeof o.worker === 'string' && typeof o.since === 'number' && typeof o.detail === 'string'
}

// With only waiting tickets (no worker) the check is slow: a dependency finishing is not urgent.
const WAIT_ONLY_MIN_MS = 5 * MINUTE
const message = (err: unknown): string => (err instanceof Error ? err.message : 'unexpected error')

// Only one Watchdog runs per app: a second start() does nothing.
let running: Watchdog | null = null

export class Watchdog {
  private readonly state = new WatchdogState()
  private readonly perProject = new Map<string, ProjectState>()
  private started = false
  private timer: unknown = null
  private timerMs = 0
  private lastProbe = -Infinity
  private cachedProjects: { at: number; list: string[] } | null = null
  // The last error logged per place; the same error is not logged again until that place works.
  private readonly errors = new Map<string, string>()

  constructor(private readonly deps: WatchdogDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private warn(where: string, text: string): void {
    if (this.errors.get(where) === text) return
    this.errors.set(where, text)
    try {
      this.deps.log?.(text)
    } catch {
      // Logging must not fail the Watchdog.
    }
  }

  // True while the single timer runs: while a worker holds a ticket, or (slowly) while a ticket waits on dependencies.
  get timerActive(): boolean {
    return this.timer !== null
  }

  start(): boolean {
    if (this.started) return true
    if (running && running !== this) return false
    running = this
    this.started = true
    this.evaluate()
    return true
  }

  // Clears the alerts it wrote (so the Router never reads stale ones), then forgets everything.
  stop(): void {
    this.disarm()
    if (this.started) {
      // Every project with Orchestration on, not only those already looked at: a file from an earlier run may be stale.
      try {
        for (const folder of this.deps.projects()) this.stateFor(folder)
      } catch {
        // Whatever is already tracked is still cleared below.
      }
    }
    this.clearAll()
    this.started = false
    this.state.clear()
    this.cachedProjects = null
    if (running === this) running = null
  }

  // Called for every hook event the app reads. Records it; with no timer running, may look at the board (rarely) to see if a claim began.
  // Never throws: a Watchdog fault must not reach the event loop.
  feed(ev: ClaudeEvent): void {
    try {
      if (!this.started || !this.deps.settings().watchdogEnabled) return
      const now = this.now
      const where = this.state.cwdFor(ev.sessionId, str(ev.payload.cwd))
      if (!where || !this.watched(where, now)) return
      this.state.record(ev, now)
      if (this.timer === null && now - this.lastProbe >= PROBE_MS) {
        this.lastProbe = now
        this.evaluate()
      }
      this.errors.delete('feed')
    } catch (err) {
      this.warn('feed', `Watchdog could not read an event (${message(err)})`)
    }
  }

  private watched(folder: string, now: number): boolean {
    if (!this.cachedProjects || now - this.cachedProjects.at > PROJECTS_TTL_MS) this.cachedProjects = { at: now, list: this.deps.projects() }
    return this.cachedProjects.list.some((p) => sameFolder(p, folder))
  }

  // Re-reads the board of every Orchestration project and brings alerts.json, the ticket logs and the timer up to date.
  // Also the way to react to Orchestration or a setting changing. Never throws.
  evaluate(): void {
    try {
      this.evaluateAll()
      this.errors.delete('evaluate')
    } catch (err) {
      this.warn('evaluate', `Watchdog could not check the boards (${message(err)})`)
    }
  }

  private evaluateAll(): void {
    this.cachedProjects = null
    if (!this.started) return
    const cfg = this.deps.settings()
    const folders = this.deps.projects()
    if (!cfg.watchdogEnabled) {
      // Off: whatever it reported earlier (even before this run) is withdrawn.
      for (const folder of folders) this.withdraw(folder, this.stateFor(folder))
      this.disarm()
      this.state.clear()
      this.perProject.clear()
      return
    }
    const now = this.now
    // A project that left Orchestration gets a final empty list; nothing is written for it afterwards.
    for (const [known, ps] of [...this.perProject]) {
      if (folders.includes(known)) continue
      this.withdraw(known, ps)
      this.perProject.delete(known)
    }
    const live = new Set<string>()
    let claimed = false
    let waiting = false
    for (const folder of folders) {
      try {
        const r = this.evaluateProject(folder, now, cfg, live)
        claimed = r.claimed || claimed
        waiting = r.waiting || waiting
        this.errors.delete(`check:${folder}`)
      } catch (err) {
        this.warn(`check:${folder}`, `Watchdog could not check ${folder} (${message(err)})`)
        // A board that cannot be read must not leave old alerts for the Router to trust.
        this.withdraw(folder, this.stateFor(folder))
      }
    }
    this.state.prune(live, now)
    const interval = cfg.watchdogIntervalSeconds * 1000
    if (claimed) this.arm(interval)
    else if (waiting) this.arm(Math.max(interval, WAIT_ONLY_MIN_MS))
    else this.disarm()
  }

  // The project's state; a project not seen yet starts from what alerts.json already says, so a restart does not log twice.
  private stateFor(folder: string): ProjectState {
    let ps = this.perProject.get(folder)
    if (!ps) {
      const before = readAlerts(folder).filter(isAlert)
      ps = { firstSeen: {}, active: new Map(before.map((a) => [alertKey(a), { alert: a }])), written: JSON.stringify(before) }
      this.perProject.set(folder, ps)
    }
    return ps
  }

  private evaluateProject(folder: string, now: number, cfg: WatchdogSettings, live: Set<string>): { claimed: boolean; waiting: boolean } {
    const { tickets } = listTickets(folder)
    const ps = this.stateFor(folder)
    const keys = new Set(trackedKeys(tickets))
    for (const k of Object.keys(ps.firstSeen)) if (!keys.has(k)) delete ps.firstSeen[k]
    for (const k of keys) ps.firstSeen[k] ??= now

    const buffers = this.state.forProject(folder, this.deps.mtime ?? realMtime)
    const claimed = tickets.filter((t) => t.status === 'In Progress' && t.worker)
    const totals = new Map<string, number>()
    for (const t of claimed) {
      const m = matchBuffer(t.worker, buffers)
      if (m && m !== 'ambiguous') {
        live.add(m.key)
        totals.set(t.id, m.total)
        this.state.mark(m.key, t.id)
      }
    }
    const wc: WatchConfig = { stallMinutes: cfg.watchdogStallMinutes, loopRepeats: cfg.watchdogLoopRepeats, waitMinutes: cfg.watchdogWaitMinutes }
    const raw = analyse({ tickets, buffers, firstSeen: ps.firstSeen }, now, wc)
    this.report(folder, ps, settle(ps.active, raw, { now, cfg: wc, totals, holders: new Map(claimed.map((t) => [t.id, t.worker])) }))
    return { claimed: claimed.length > 0, waiting: [...keys].some((k) => k.startsWith('wait|')) }
  }

  private withdraw(folder: string, ps: ProjectState): void {
    try {
      this.report(folder, ps, new Map())
    } catch (err) {
      this.warn(`check:${folder}`, `Watchdog could not clear the alerts of ${folder} (${message(err)})`)
    }
  }

  private clearAll(): void {
    for (const [folder, ps] of this.perProject) this.withdraw(folder, ps)
    this.perProject.clear()
  }

  // alerts.json only when the set of (ticket, kind, text without numbers) changed; one log line per ticket and kind when it
  // appears and when it clears.
  private report(folder: string, ps: ProjectState, next: Map<string, HeldAlert>): void {
    const alerts = [...next.values()].map((h) => h.alert).sort(compareAlerts)
    const json = JSON.stringify(alerts)
    if (json === ps.written) {
      ps.active = next
      return
    }
    try {
      mkdirSync(ticketsDir(folder), { recursive: true })
      writeAtomic(alertsPath(folder), `${JSON.stringify(alerts, null, 2)}\n`)
    } catch (err) {
      this.warn(`write:${folder}`, `Watchdog could not write alerts.json in ${folder} (${message(err)})`)
      return
    }
    this.errors.delete(`write:${folder}`)
    ps.written = json
    const note = (id: string, text: string): void => {
      try {
        logEvent(folder, id, text)
      } catch {
        // The ticket may be gone; the alert file is the record that matters.
      }
    }
    for (const [k, h] of next) if (!ps.active.has(k)) note(h.alert.ticketId, `watchdog alert ${h.alert.kind}${h.alert.worker ? ` (${h.alert.worker})` : ''}: ${h.alert.detail}`)
    for (const [k, h] of ps.active) if (!next.has(k)) note(h.alert.ticketId, `watchdog alert cleared: ${h.alert.kind}`)
    ps.active = next
  }

  private arm(ms: number): void {
    if (this.timer !== null && this.timerMs === ms) return
    this.disarm()
    this.timerMs = ms
    this.timer = this.deps.scheduler.every(() => this.evaluate(), ms)
  }

  private disarm(): void {
    if (this.timer !== null) this.deps.scheduler.cancel(this.timer)
    this.timer = null
  }
}
