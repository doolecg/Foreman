import type { GraphSubagent, OrchestrationGraph } from '../shared/orchestration-graph'
import { roleOf, type Role } from '../shared/orchestration-role'
import type { ClaudeEvent } from './claude-events'

// Derives the Orchestration graph from one Claude session's hook events (the same events scripts/op-event.mjs writes).
// The rules follow the Model Engine live server: which agent is which, what counts as a recall call, and how a reply
// becomes a verdict. Nothing is invented: a state changes only when an event says so, and an idle stream stays idle.

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)


// The first word of a reply, when it is one of the verdict words ("pass: 12 tests", "reject - missing test").
const VERDICT = /^[^a-z]*(approve|reject|pass|note|fail)\b/i
export function replyVerdict(text: unknown): 'approve' | 'reject' | 'pass' | 'note' | 'fail' | null {
  const m = VERDICT.exec(typeof text === 'string' ? text : '')
  return m?.[1] ? (m[1].toLowerCase() as 'approve' | 'reject' | 'pass' | 'note' | 'fail') : null
}

export const emptyGraph = (sessionId: string, project: string | null = null): OrchestrationGraph => ({
  sessionId,
  project,
  orch: 'idle',
  builder: 'idle',
  opus: 'idle',
  verdict: null,
  calls: 0,
  council: { ui: 'idle', code: 'idle', run: 'idle' },
  recall: { cg: 0, hs: 0, grep: 0, saved: 0, run: false },
  subagents: [],
})

// An Agent/Task tool call seen before its sub-agent started: it carries the description and the requested model.
interface PendingCall {
  toolUseId: string | null
  type: string | null
  description: string | null
  model: string | null
}

// One graph per session (state never crosses sessions), most recently active last.
export interface GraphStore {
  graphs: Map<string, OrchestrationGraph>
  pending: Map<string, PendingCall[]>
  // Sessions that sent SessionEnd, oldest first.
  ended: Set<string>
}

export const createGraphStore = (): GraphStore => ({ graphs: new Map(), pending: new Map(), ended: new Set() })

// Bounds, so a long-lived app does not grow without limit (nothing runs on a timer; pruning happens as events arrive).
const MAX_FINISHED_SUBAGENTS = 50
const MAX_PENDING_CALLS = 20
const MAX_ENDED_SESSIONS = 5
const MAX_SESSIONS = 50

function forget(store: GraphStore, sessionId: string) {
  store.graphs.delete(sessionId)
  store.pending.delete(sessionId)
  store.ended.delete(sessionId)
}

// Keeps every running sub-agent and the newest MAX_FINISHED_SUBAGENTS finished ones.
function pruneSubagents(g: OrchestrationGraph) {
  let finished = g.subagents.filter((a) => a.status !== 'running').length
  if (finished <= MAX_FINISHED_SUBAGENTS) return
  g.subagents = g.subagents.filter((a) => a.status === 'running' || finished-- <= MAX_FINISHED_SUBAGENTS)
}

// Ended sessions keep only the newest few; the total is capped too, dropping the least recently active.
function pruneSessions(store: GraphStore) {
  for (const id of store.ended) {
    if (store.ended.size <= MAX_ENDED_SESSIONS) break
    forget(store, id)
  }
  for (const id of store.graphs.keys()) {
    if (store.graphs.size <= MAX_SESSIONS) break
    forget(store, id)
  }
}

// The newest session's graph for a project folder; null when no event came from it.
export function graphForProject(store: GraphStore, project: string): OrchestrationGraph | null {
  let found: OrchestrationGraph | null = null
  for (const g of store.graphs.values()) if (g.project === project) found = g
  return found
}

function startRole(g: OrchestrationGraph, role: Role) {
  if (role === 'opus') g.opus = 'awake'
  else if (role === 'builder') g.builder = 'building'
  else if (role === 'recall') g.recall.run = true
  else g.council[role] = 'running'
}

function stopRole(g: OrchestrationGraph, role: Role, reply: unknown) {
  const v = replyVerdict(reply)
  if (role === 'opus') {
    g.opus = 'idle'
    g.calls++
    g.verdict = v === 'approve' || v === 'reject' ? v : null
  } else if (role === 'builder') g.builder = 'done'
  else if (role === 'recall') g.recall.run = false
  else g.council[role] = v === 'pass' || v === 'note' || v === 'fail' ? v : 'done'
}

const findAgent = (g: OrchestrationGraph, id: string): GraphSubagent | undefined => g.subagents.find((a) => a.id === id)
// A hook payload that names no agent_id is matched by agent_type, as the Model Engine does.
const findRunning = (g: OrchestrationGraph, name: string | undefined): GraphSubagent | undefined => g.subagents.find((a) => a.status === 'running' && a.name === name)

// Applies one hook event. Returns true when the graph for that session changed.
export function applyGraphEvent(store: GraphStore, ev: ClaudeEvent): boolean {
  const p = ev.payload
  const cwd = str(p.cwd)
  if (ev.name === 'SessionStart' && p.source !== 'compact') {
    // A new, resumed or cleared session starts from nothing; a compaction keeps its sub-agents.
    forget(store, ev.sessionId)
  }
  const g = store.graphs.get(ev.sessionId) ?? emptyGraph(ev.sessionId)
  if (cwd) g.project = cwd
  // Re-insert so the Map order is least to most recently active.
  store.graphs.delete(ev.sessionId)
  store.graphs.set(ev.sessionId, g)
  // Any event from a session means it is live again (a resumed id).
  store.ended.delete(ev.sessionId)
  const pending = store.pending.get(ev.sessionId) ?? []
  store.pending.set(ev.sessionId, pending)
  pruneSessions(store)

  switch (ev.name) {
    case 'SessionStart':
      return true
    case 'UserPromptSubmit': {
      // Calls that never started a sub-agent (denied, cancelled) must not label the next one.
      pending.length = 0
      // Only finished states reset; sub-agents still running keep theirs.
      g.orch = 'thinking'
      g.verdict = null
      if (g.builder === 'done') g.builder = 'idle'
      for (const k of ['ui', 'code', 'run'] as const) if (g.council[k] !== 'running') g.council[k] = 'idle'
      return true
    }
    case 'PreToolUse': {
      const tool = str(p.tool_name)
      if (tool !== 'Agent' && tool !== 'Task') return false
      const input = obj(p.tool_input)
      pending.push({ toolUseId: str(p.tool_use_id) ?? null, type: str(input.subagent_type) ?? null, description: str(input.description) ?? null, model: str(input.model) ?? null })
      if (pending.length > MAX_PENDING_CALLS) pending.shift()
      return false
    }
    case 'PostToolUseFailure': {
      // A refused or failed Agent call never started a sub-agent.
      const at = pending.findIndex((c) => c.toolUseId !== null && c.toolUseId === str(p.tool_use_id))
      if (at >= 0) pending.splice(at, 1)
      return false
    }
    case 'SubagentStart': {
      const type = str(p.agent_type)
      const realId = str(p.agent_id)
      if (realId && findAgent(g, realId)) return false
      if (!realId && !type) return false
      const id = realId ?? `${type}@${ev.ts}-${g.subagents.length}`
      // The newest call of this type is the one that started. Older ones of the same type never started (refused, cancelled), so they go.
      const at = pending.map((c) => c.type).lastIndexOf(type ?? null)
      const call = at >= 0 ? pending[at] : undefined
      for (let i = pending.length - 1; i >= 0; i--) if (i <= at && pending[i]?.type === (type ?? null)) pending.splice(i, 1)
      g.subagents.push({ id, name: type ?? 'agent', model: call?.model ?? null, doing: call?.description ?? null, startedAt: ev.ts || null, endedAt: null, status: 'running' })
      pruneSubagents(g)
      const role = roleOf(type)
      if (role) startRole(g, role)
      return true
    }
    case 'SubagentStop': {
      const id = str(p.agent_id)
      const a = id ? findAgent(g, id) : findRunning(g, str(p.agent_type))
      const type = str(p.agent_type) ?? a?.name
      if (a && a.status === 'running') {
        a.status = 'completed'
        a.endedAt = ev.ts || null
      }
      pruneSubagents(g)
      const role = roleOf(type)
      // last_assistant_message is the reply the verdict is read from; without it the role finishes with no verdict.
      if (role) stopRole(g, role, p.last_assistant_message)
      return true
    }
    case 'PostToolUse': {
      const tool = str(p.tool_name) ?? ''
      if (tool === 'Agent' || tool === 'Task') {
        const done = pending.findIndex((c) => c.toolUseId !== null && c.toolUseId === str(p.tool_use_id))
        if (done >= 0) pending.splice(done, 1)
        const resp = obj(p.tool_response)
        const id = str(resp.agentId) ?? str(resp.agent_id)
        const a = id ? findAgent(g, id) : undefined
        if (!a) return false
        a.model ??= str(resp.resolvedModel) ?? null
        if (resp.is_error === true && a.status !== 'failed') {
          a.status = 'failed'
          a.endedAt ??= ev.ts || null
        }
        return true
      }
      const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
      if (mcp?.[1] === 'codegraph') g.recall.cg++
      else if (mcp?.[1] === 'hindsight') {
        if (/ingest|capture/.test(mcp[2] ?? '')) g.recall.saved++
        else g.recall.hs++
      } else if (tool === 'Grep') g.recall.grep++
      return true
    }
    case 'Stop':
      // 'done?' as in the Model Engine: the main thread stopped, whether the work is finished is for the user to judge.
      pending.length = 0
      g.orch = 'done?'
      return true
    case 'SessionEnd': {
      // The session is gone: anything still running has no evidence of how it ended.
      pending.length = 0
      g.orch = 'idle'
      if (g.builder === 'building') g.builder = 'idle'
      if (g.opus === 'awake') g.opus = 'idle'
      g.recall.run = false
      for (const k of ['ui', 'code', 'run'] as const) if (g.council[k] === 'running') g.council[k] = 'idle'
      for (const a of g.subagents) {
        if (a.status !== 'running') continue
        a.status = 'unknown'
        a.endedAt ??= ev.ts || null
      }
      pruneSubagents(g)
      store.ended.add(ev.sessionId)
      pruneSessions(store)
      return true
    }
    default:
      return false
  }
}
