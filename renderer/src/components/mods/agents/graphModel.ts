import type { GraphCouncilState, GraphSubagent, OrchestrationGraph } from '@shared/orchestration-graph'
import { roleOf } from '@shared/orchestration-role'

// Pure parts of the Orchestration graph view (GraphView.tsx): which layout fits, which links carry traffic, and what each
// card says. Everything is read from the graph state; nothing is guessed, and a null graph is the idle picture.

export type Layout = 'compact' | 'wide'
// The container width (px) under which the graph uses the compact, single-column layout.
export const COMPACT_BELOW = 700
export const layoutForWidth = (width: number): Layout => (width < COMPACT_BELOW ? 'compact' : 'wide')

// The Small | Large choice: Small is the narrow single column, Large the two-column one. No choice means by width.
export type GraphSize = 'small' | 'large'
export const layoutForSize = (size: GraphSize | undefined, width: number): Layout => (size === 'large' ? 'wide' : size === 'small' ? 'compact' : layoutForWidth(width))

export type CouncilKey = 'ui' | 'code' | 'run'
export const COUNCIL_KEYS: readonly CouncilKey[] = ['ui', 'code', 'run']

const finished = (s: GraphCouncilState): boolean => s === 'done' || s === 'pass' || s === 'note' || s === 'fail'

export interface LinkLit {
  ask: boolean
  verdict: boolean
  commit: boolean
  ctx: boolean
  delegate: boolean
  back: boolean
  // Names the failure only while a council member failed.
  backLabel: string
  // The loadout line is a static wire: it never carries traffic.
  load: false
  call: boolean
  // A freelancer is running.
  free: boolean
  findings: Record<CouncilKey, boolean>
  findingsAny: boolean
}

// A link is lit only when the state says something moves along it.
export function graphLinks(g: OrchestrationGraph | null): LinkLit {
  const council = g?.council ?? { ui: 'idle' as const, code: 'idle' as const, run: 'idle' as const }
  const states = COUNCIL_KEYS.map((k) => council[k])
  const anyFail = states.includes('fail')
  const findings = { ui: finished(council.ui), code: finished(council.code), run: finished(council.run) }
  return {
    ask: g?.opus === 'awake',
    verdict: g?.verdict != null,
    commit: g?.verdict === 'approve' && g.orch === 'done?',
    ctx: g?.recall.run === true,
    delegate: g?.builder === 'building',
    back: g?.builder === 'done' || anyFail,
    backLabel: anyFail ? 'council fail → brain' : 'done? → brain',
    load: false,
    call: states.includes('running'),
    free: freelancers(g).some((a) => a.status === 'running'),
    findings,
    findingsAny: findings.ui || findings.code || findings.run,
  }
}

export type BarFill = 'empty' | 'run' | 'full'
export type Tone = 'dim' | 'run' | 'ok' | 'fail'

export interface CardView {
  active: boolean
  fill: BarFill
  tone: Tone
  // A tick or a cross, so the state never rests on colour alone.
  glyph: '✓' | '✖' | ''
  text: string
}

export const orchestratorCard = (g: OrchestrationGraph | null): CardView => {
  const o = g?.orch ?? 'idle'
  if (o === 'thinking' || o === 'writing') return { active: true, fill: 'run', tone: 'run', glyph: '', text: o }
  if (o === 'done?') return { active: false, fill: 'full', tone: 'ok', glyph: '✓', text: 'done?' }
  return { active: false, fill: 'empty', tone: 'dim', glyph: '', text: 'idle' }
}

export const brainCard = (g: OrchestrationGraph | null): CardView => {
  if (g?.opus === 'awake') return { active: true, fill: 'empty', tone: 'run', glyph: '', text: 'awake' }
  if (g?.verdict === 'reject') return { active: false, fill: 'empty', tone: 'fail', glyph: '✖', text: 'reject' }
  if (g?.verdict === 'approve') return { active: false, fill: 'empty', tone: 'ok', glyph: '✓', text: 'approve' }
  return { active: false, fill: 'empty', tone: 'dim', glyph: '', text: 'idle' }
}

export const builderCard = (g: OrchestrationGraph | null): CardView => {
  if (g?.builder === 'building') return { active: true, fill: 'run', tone: 'run', glyph: '', text: 'building' }
  if (g?.builder === 'done') return { active: false, fill: 'full', tone: 'ok', glyph: '✓', text: 'done' }
  return { active: false, fill: 'empty', tone: 'dim', glyph: '', text: 'waiting' }
}

export const councilCard = (g: OrchestrationGraph | null, key: CouncilKey): CardView => {
  const s = g?.council[key] ?? 'idle'
  if (s === 'running') return { active: true, fill: 'run', tone: 'run', glyph: '', text: 'running' }
  if (s === 'fail') return { active: false, fill: 'full', tone: 'fail', glyph: '✖', text: 'fail' }
  if (s === 'pass' || s === 'done' || s === 'note') return { active: false, fill: 'full', tone: 'ok', glyph: '✓', text: s }
  return { active: false, fill: 'empty', tone: 'dim', glyph: '', text: 'idle' }
}

// What the Builder is working on: the Agent call's description of its newest running sub-agent, null when none says.
export function builderTask(g: OrchestrationGraph | null): string | null {
  if (!g) return null
  for (let i = g.subagents.length - 1; i >= 0; i--) {
    const a = g.subagents[i]!
    if (a.status === 'running' && /builder/i.test(a.name) && a.doing) return a.doing
  }
  return null
}

// Sub-agents with no node of their own in the graph (runner, designer, Explore, any custom agent), oldest first.
export const freelancers = (g: OrchestrationGraph | null): GraphSubagent[] => (g ? g.subagents.filter((a) => roleOf(a.name) === null) : [])

export const FREELANCER_ROWS = 4

export interface FreelancerRow {
  id: string
  name: string
  model: string | null
  doing: string | null
  running: boolean
  // A tick or a cross for a finished one, so the state never rests on colour alone.
  glyph: '✓' | '✖' | ''
  status: GraphSubagent['status']
}

export interface FreelancerView {
  // Total freelancers seen, running or not.
  count: number
  running: number
  // Running ones first, then the newest finished; at most FREELANCER_ROWS.
  rows: FreelancerRow[]
  more: number
}

export function freelancerView(g: OrchestrationGraph | null): FreelancerView {
  const all = freelancers(g)
  const running = all.filter((a) => a.status === 'running')
  const rest = all.filter((a) => a.status !== 'running').reverse()
  const shown = [...running.slice().reverse(), ...rest].slice(0, FREELANCER_ROWS)
  return {
    count: all.length,
    running: running.length,
    rows: shown.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      doing: a.doing,
      running: a.status === 'running',
      glyph: a.status === 'failed' ? '✖' : a.status === 'completed' ? '✓' : '',
      status: a.status,
    })),
    more: Math.max(0, all.length - FREELANCER_ROWS),
  }
}

export const recallCounts =(g: OrchestrationGraph | null): { cg: string; hs: string } => {
  const r = g?.recall ?? { cg: 0, hs: 0, grep: 0, saved: 0, run: false }
  return { cg: `${r.cg} explores · ${r.grep} greps`, hs: `${r.hs} recalls · ${r.saved} saved` }
}

export const graphIsActive = (g: OrchestrationGraph | null): boolean =>
  !!g && (g.orch === 'thinking' || g.orch === 'writing' || g.opus === 'awake' || g.builder === 'building' || g.recall.run || COUNCIL_KEYS.some((k) => g.council[k] === 'running') || freelancers(g).some((a) => a.status === 'running'))

// ---- the List | Graph choice, kept per project

export type PanelView = 'list' | 'graph'
const viewKey = (crewId: number): string => `foreman.agents.view.${crewId}`

export function loadPanelView(crewId: number): PanelView {
  try {
    return localStorage.getItem(viewKey(crewId)) === 'graph' ? 'graph' : 'list'
  } catch {
    return 'list'
  }
}

export function savePanelView(crewId: number, view: PanelView): void {
  try {
    localStorage.setItem(viewKey(crewId), view)
  } catch {
    /* storage unavailable */
  }
}

// ---- the Small | Large choice, kept per project and per place (the side panel and the pop-out window choose separately)

export type GraphPlace = 'panel' | 'popout'
const sizeKey = (place: GraphPlace, crewId: number): string => `foreman.agents.size.${place}.${crewId}`
// The panel is narrow, so it starts Small; the pop-out window is wide, so it starts Large.
const sizeDefault = (place: GraphPlace): GraphSize => (place === 'popout' ? 'large' : 'small')

export function loadGraphSize(place: GraphPlace, crewId: number): GraphSize {
  try {
    const v = localStorage.getItem(sizeKey(place, crewId))
    return v === 'small' || v === 'large' ? v : sizeDefault(place)
  } catch {
    return sizeDefault(place)
  }
}

export function saveGraphSize(place: GraphPlace, crewId: number, size: GraphSize): void {
  try {
    localStorage.setItem(sizeKey(place, crewId), size)
  } catch {
    /* storage unavailable */
  }
}

// The Large view asks its tile's side panel for room: ModsHost listens for this event on the window. The detail is
// { tileId, width }; a null width puts the panel back to its usual width.
export const WIDEN_PANEL = 'foreman:widen-side-panel'
export const LARGE_PANEL_WIDTH = 820
