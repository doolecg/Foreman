import type { SubagentStatus } from './mods'

// The Orchestration graph state, derived from one Claude session's hook events (core/orchestration-graph.ts).
// The values match the Model Engine graph so the same panel can draw either.

export type GraphOrch = 'idle' | 'thinking' | 'writing' | 'done?'
export type GraphBuilder = 'idle' | 'building' | 'done'
export type GraphOpus = 'idle' | 'awake'
export type GraphVerdict = 'approve' | 'reject' | null
export type GraphCouncilState = 'idle' | 'running' | 'done' | 'pass' | 'note' | 'fail'

export interface GraphSubagent {
  id: string
  name: string
  // null when no event named the model.
  model: string | null
  // The Agent tool call's description; null when the call was not seen.
  doing: string | null
  startedAt: number | null
  endedAt: number | null
  status: SubagentStatus
}

export interface OrchestrationGraph {
  sessionId: string
  // The session's working directory (the hook payload's cwd); null when no event carried it.
  project: string | null
  orch: GraphOrch
  builder: GraphBuilder
  opus: GraphOpus
  // The reviewer's last reply, only when its first word was approve or reject.
  verdict: GraphVerdict
  // Reviewer calls that finished.
  calls: number
  council: { ui: GraphCouncilState; code: GraphCouncilState; run: GraphCouncilState }
  recall: { cg: number; hs: number; grep: number; saved: number; run: boolean }
  subagents: GraphSubagent[]
}
