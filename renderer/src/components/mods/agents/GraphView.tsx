import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { OrchestrationGraph } from '@shared/orchestration-graph'
import { cn } from '@/lib/utils'
import {
  brainCard,
  builderCard,
  builderTask,
  councilCard,
  freelancerView,
  graphIsActive,
  graphLinks,
  layoutForSize,
  orchestratorCard,
  recallCounts,
  type CardView,
  type CouncilKey,
  type GraphSize,
  type Layout,
  type LinkLit,
  type Tone,
} from './graphModel'

// The Orchestration graph: the agents of the Model Engine flow as cards, with the links that carry traffic lit. It draws
// the graph state (core/orchestration-graph.ts) and invents nothing: an idle or missing graph is all dim.
// Backgrounds, borders and text come from the theme tokens; only the agent accents are fixed colours.

const ACCENT = { green: '#4ade80', purple: '#8b7cf6', amber: '#f5a742', teal: '#3fe0c5', pink: '#f472b6', white: 'var(--foreground)' } as const
type Accent = keyof typeof ACCENT

const TONE_TEXT: Record<Tone, string> = { dim: 'text-muted-foreground', run: 'text-foreground', ok: 'text-success', fail: 'text-destructive' }
const toneColor = (tone: Tone, accent: string): string => (tone === 'fail' ? 'var(--destructive)' : accent)
const cssVars = (c: string): CSSProperties => ({ '--c': c }) as CSSProperties

function SectionLabel({ name, accent }: { name: string; accent: Accent }) {
  return (
    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.22em]">
      <i aria-hidden className="size-[7px] rounded-full" style={{ background: ACCENT[accent] }} />
      {name}
    </div>
  )
}

// Thin pixel-cell progress: sweeping block while running, full when done, empty when idle. No percentages.
function Bar({ card, color, motion, label }: { card: CardView; color: string; motion: boolean; label: string }) {
  return (
    <div role="img" aria-label={`${label}: ${card.text}`} className="og-track my-1">
      <i className={cn('og-fill', card.fill === 'run' && motion && 'og-sweep')} data-fill={card.fill} style={cssVars(color)} />
    </div>
  )
}

function StateLine({ card, label }: { card: CardView; label?: string }) {
  return (
    <span className={cn('text-[11.5px]', TONE_TEXT[card.tone])}>
      {card.glyph && <span aria-hidden>{card.glyph} </span>}
      {label ? `${label} ` : ''}
      {card.text}
    </span>
  )
}

function Card({ k, title, sub, accent, card, motion, children, label }: { k: string; title: string; sub?: string; accent: Accent; card: CardView | null; motion: boolean; children?: ReactNode; label: string }) {
  const active = card?.active === true
  const color = ACCENT[accent]
  return (
    <div
      role="group"
      aria-label={label}
      data-k={k}
      data-active={active}
      className={cn('og-card bg-card min-w-0 rounded-[9px] border-[1.5px] px-2.5 py-1.5')}
      // Idle cards keep a faint accent edge (in the CSS) so each agent stays recognisable. A running one gets marching
      // dashes drawn over that edge (the svg below); with motion off it gets a solid full-colour border.
      style={{ ...cssVars(color), borderColor: active && !motion ? color : undefined }}
    >
      {active && motion && (
        <svg aria-hidden className="og-march pointer-events-none absolute -inset-[1.5px] size-[calc(100%+3px)] overflow-visible">
          <rect x=".75" y=".75" rx="8.5" style={{ width: 'calc(100% - 1.5px)', height: 'calc(100% - 1.5px)' }} />
        </svg>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-bold tracking-[0.04em]">
          {active && <i aria-hidden className={cn('og-dot', motion && 'og-blink')} />}
          {title}
        </span>
        {sub && <span className="text-muted-foreground truncate text-[11px]">{sub}</span>}
      </div>
      {children}
    </div>
  )
}

function Orchestrator({ g, motion }: { g: OrchestrationGraph | null; motion: boolean }) {
  const c = orchestratorCard(g)
  return (
    <Card k="orc" title="ORCHESTRATOR" sub="chat" accent="green" card={c} motion={motion} label={`Orchestrator: ${c.text}`}>
      <Bar card={c} color={toneColor(c.tone, ACCENT.green)} motion={motion} label="Orchestrator" />
      <StateLine card={c} />
    </Card>
  )
}

function Brain({ g, motion, wide }: { g: OrchestrationGraph | null; motion: boolean; wide: boolean }) {
  const c = brainCard(g)
  return (
    <Card k="brain" title="OPUS 5.5" sub="BRAIN" accent="purple" card={c} motion={motion} label={`Brain, Opus 5.5: ${c.text}`}>
      {wide && <div className="text-muted-foreground mt-1 text-[11px]">plan locks · same error ×2 · before done</div>}
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <StateLine card={c} />
        <span className="text-muted-foreground text-[11px]">
          calls <b className="text-foreground">{g?.calls ?? 0}</b>
        </span>
      </div>
    </Card>
  )
}

function Recall({ g, motion }: { g: OrchestrationGraph | null; motion: boolean }) {
  const counts = recallCounts(g)
  const active = g?.recall.run === true
  const mini = (name: string, accent: Accent, text: string) => (
    <div className="min-w-0 rounded-md border px-1.5 py-1 text-[11px]" style={{ borderColor: active ? ACCENT[accent] : 'var(--border)' }}>
      <b className="block text-[10.5px] tracking-[0.04em]" style={{ color: ACCENT[accent] }}>
        <span aria-hidden>● </span>
        {name}
      </b>
      <span className="text-muted-foreground">{text}</span>
    </div>
  )
  const card: CardView = { active, fill: 'empty', tone: active ? 'run' : 'dim', glyph: '', text: active ? 'searching' : 'idle' }
  return (
    <Card k="recall" title="RECALL" sub="haiku 5.5" accent="teal" card={card} motion={motion} label={`Recall: ${card.text}. CodeGraph ${counts.cg}. Hindsight ${counts.hs}`}>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {mini('CODEGRAPH', 'teal', counts.cg)}
        {mini('HINDSIGHT', 'amber', counts.hs)}
      </div>
    </Card>
  )
}

function Builder({ g, motion, wide }: { g: OrchestrationGraph | null; motion: boolean; wide: boolean }) {
  const c = builderCard(g)
  const task = builderTask(g)
  return (
    <Card k="build" title="BUILDER" sub={wide ? 'sonnet 5.5 · projects only' : 'sonnet 5.5'} accent="white" card={c} motion={motion} label={`Builder: ${c.text}`}>
      <div className="text-muted-foreground truncate text-[11.5px]">{c.active && task ? task : 'idle'}</div>
      <Bar card={c} color={toneColor(c.tone, ACCENT.white)} motion={motion} label="Builder" />
      <StateLine card={c} />
      {wide && <div className="text-muted-foreground mt-1 text-[11.5px]">applies council findings</div>}
    </Card>
  )
}

function Loadout({ motion }: { motion: boolean }) {
  return (
    <Card k="load" title="LOADOUT" accent="white" card={null} motion={motion} label="Loadout: codegraph and hindsight">
      <div className="border-border my-1 border-t" />
      <div className="flex justify-end gap-2 pt-0.5">
        <i role="img" aria-label="codegraph" title="codegraph" className="size-[8px] rounded-full" style={{ background: ACCENT.teal }} />
        <i role="img" aria-label="hindsight" title="hindsight" className="size-[8px] rounded-full" style={{ background: ACCENT.amber }} />
      </div>
    </Card>
  )
}

const COUNCIL: Array<{ key: CouncilKey; name: string; what: string }> = [
  { key: 'ui', name: 'UI', what: 'layout · screenshots' },
  { key: 'code', name: 'CODE', what: 'diff · bugs · style' },
  { key: 'run', name: 'RUN', what: 'tests · app boots' },
]

function CouncilCard({ g, k, motion, wide }: { g: OrchestrationGraph | null; k: (typeof COUNCIL)[number]; motion: boolean; wide: boolean }) {
  const c = councilCard(g, k.key)
  return (
    <Card k={k.key} title={k.name} sub="haiku 5.5" accent="green" card={c} motion={motion} label={`Council ${k.name}: ${c.text}`}>
      {wide && <div className="text-muted-foreground text-[11px]">{k.what}</div>}
      <Bar card={c} color={toneColor(c.tone, ACCENT.green)} motion={motion} label={`Council ${k.name}`} />
      <StateLine card={c} />
    </Card>
  )
}

// Sub-agents with no node of their own. Empty and dim until one runs.
function Freelancer({ g, motion }: { g: OrchestrationGraph | null; motion: boolean }) {
  const v = freelancerView(g)
  const active = v.running > 0
  const card: CardView = { active, fill: 'empty', tone: active ? 'run' : 'dim', glyph: '', text: active ? 'running' : 'idle' }
  return (
    <Card k="free" title="FREELANCER" sub={v.count > 0 ? `${v.count} seen` : 'none'} accent="pink" card={card} motion={motion} label={v.count > 0 ? `Freelancers: ${v.running} running, ${v.count} seen` : 'Freelancers: none'}>
      {v.rows.length === 0 ? (
        <div className="text-muted-foreground text-[11.5px]">no freelancers</div>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {v.rows.map((r) => (
            <li key={r.id} data-status={r.status} className="flex min-w-0 items-baseline gap-1.5 text-[11.5px]">
              <i aria-hidden className={cn('og-dot', r.running && motion && 'og-blink')} style={{ ...cssVars(ACCENT.pink), opacity: r.running ? 1 : 0.4 }} />
              <b className="shrink-0">{r.name}</b>
              {r.model && <span className="text-muted-foreground shrink-0 text-[10.5px]">{r.model}</span>}
              <span className={cn('min-w-0 flex-1 truncate', r.running ? 'text-foreground' : 'text-muted-foreground')}>{r.doing ?? ''}</span>
              <span className={cn('shrink-0', r.glyph === '✖' ? 'text-destructive' : 'text-muted-foreground')}>
                {r.glyph && <span aria-hidden>{r.glyph} </span>}
                {r.status}
              </span>
            </li>
          ))}
          {v.more > 0 && <li className="text-muted-foreground text-[11px]">+{v.more} more</li>}
        </ul>
      )}
    </Card>
  )
}

function Group({ name, accent, children }: { name: string; accent: Accent; children: ReactNode }) {
  return (
    <div className="border-border rounded-[11px] border border-dashed p-1.5">
      <SectionLabel name={name} accent={accent} />
      {children}
    </div>
  )
}

// ---- links: drawn between the measured cards, shared by the wide and the compact layout

type Side = 't' | 'b' | 'l' | 'r'
interface LinkDef {
  id: string
  from: string
  fromSide: Side
  fromOff: number
  to: string
  toSide: Side
  toOff: number
  accent: Accent
  label: string
  extra?: number // pushes a same-side loop further out, so two loops on one side do not share a lane
  drop?: number // compact only: a link from a card's bottom edge to a side edge runs this far down first, then out round the gutter
  tag?: 'l' | 'r' | 'turn' // compact only: label left or right of a straight line, or turned along a side loop
}

// Same routes as the approved mockup.
const WIDE_LINKS: LinkDef[] = [
  { id: 'ask', from: 'orc', fromSide: 'b', fromOff: -30, to: 'brain', toSide: 't', toOff: -30, accent: 'purple', label: 'ask' },
  { id: 'verdict', from: 'brain', fromSide: 't', fromOff: 30, to: 'orc', toSide: 'b', toOff: 30, accent: 'purple', label: 'verdict' },
  { id: 'commit', from: 'brain', fromSide: 'r', fromOff: -22, to: 'recall', toSide: 'l', toOff: 18, accent: 'amber', label: 'commit → memory' },
  { id: 'ctx', from: 'recall', fromSide: 'b', fromOff: 0, to: 'build', toSide: 't', toOff: 0, accent: 'teal', label: 'CTX' },
  { id: 'delegate', from: 'brain', fromSide: 'r', fromOff: 10, to: 'build', toSide: 'l', toOff: -8, accent: 'white', label: 'delegate → builder' },
  { id: 'back', from: 'build', fromSide: 'l', fromOff: 8, to: 'brain', toSide: 'r', toOff: 34, accent: 'purple', label: 'done? → brain' },
  { id: 'load', from: 'build', fromSide: 'b', fromOff: -40, to: 'load', toSide: 't', toOff: 30, accent: 'teal', label: 'load' },
  { id: 'call', from: 'build', fromSide: 'b', fromOff: 40, to: 'ui', toSide: 't', toOff: 40, accent: 'white', label: 'call' },
  { id: 'free', from: 'build', fromSide: 'r', fromOff: 30, to: 'free', toSide: 'r', toOff: 0, accent: 'pink', label: 'freelance', extra: 30 },
  { id: 'f-ui', from: 'ui', fromSide: 'r', fromOff: 0, to: 'build', toSide: 'r', toOff: -20, accent: 'green', label: 'findings' },
  { id: 'f-code', from: 'code', fromSide: 'r', fromOff: 0, to: 'build', toSide: 'r', toOff: 0, accent: 'green', label: '', extra: 10 },
  { id: 'f-run', from: 'run', fromSide: 'r', fromOff: 0, to: 'build', toSide: 'r', toOff: 20, accent: 'green', label: '', extra: 20 },
]

// One tall column. Straight links run down the middle, the skip-a-card ones loop round the sides.
const TALL_LINKS: LinkDef[] = [
  { id: 'ask', from: 'orc', fromSide: 'b', fromOff: -26, to: 'brain', toSide: 't', toOff: -26, accent: 'purple', label: 'ask', tag: 'l' },
  { id: 'verdict', from: 'brain', fromSide: 't', fromOff: 26, to: 'orc', toSide: 'b', toOff: 26, accent: 'purple', label: 'verdict', tag: 'r' },
  { id: 'commit', from: 'brain', fromSide: 'b', fromOff: -26, to: 'recall', toSide: 't', toOff: -26, accent: 'amber', label: 'commit → memory', tag: 'l' },
  { id: 'recalled', from: 'recall', fromSide: 't', fromOff: 26, to: 'brain', toSide: 'b', toOff: 26, accent: 'teal', label: 'results', tag: 'r' },
  { id: 'ctx', from: 'recall', fromSide: 'b', fromOff: -26, to: 'build', toSide: 't', toOff: -26, accent: 'teal', label: 'CTX', tag: 'l' },
  { id: 'delegate', from: 'brain', fromSide: 'r', fromOff: 0, to: 'build', toSide: 'r', toOff: -10, accent: 'white', label: 'delegate', extra: 4, tag: 'turn' },
  { id: 'back', from: 'build', fromSide: 'l', fromOff: 0, to: 'brain', toSide: 'l', toOff: 0, accent: 'purple', label: 'done? → brain', tag: 'turn' },
  { id: 'call', from: 'build', fromSide: 'b', fromOff: 0, to: 'code', toSide: 't', toOff: 0, accent: 'white', label: 'call', tag: 'r' },
  { id: 'free', from: 'build', fromSide: 'l', fromOff: 14, to: 'free', toSide: 'l', toOff: 0, accent: 'pink', label: 'freelance', tag: 'turn' },
  { id: 'free-back', from: 'free', fromSide: 'r', fromOff: 0, to: 'build', toSide: 'r', toOff: 12, accent: 'pink', label: '', extra: 22 },
  // Each council card reports to the builder: down under the row, then up the right gutter on one shared lane.
  { id: 'f-ui', from: 'ui', fromSide: 'b', fromOff: 0, to: 'build', toSide: 'r', toOff: 12, accent: 'green', label: 'findings', extra: 22, drop: 26, tag: 'turn' },
  { id: 'f-code', from: 'code', fromSide: 'b', fromOff: 0, to: 'build', toSide: 'r', toOff: 12, accent: 'green', label: '', extra: 22, drop: 20 },
  { id: 'f-run', from: 'run', fromSide: 'b', fromOff: 0, to: 'build', toSide: 'r', toOff: 12, accent: 'green', label: '', extra: 22, drop: 14 },
]

const litOf = (id: string, lit: LinkLit): boolean => {
  switch (id) {
    case 'ask': return lit.ask
    case 'verdict': return lit.verdict
    case 'commit': return lit.commit
    case 'ctx': return lit.ctx
    case 'delegate': return lit.delegate
    case 'back': return lit.back
    case 'call': return lit.call
    case 'free': return lit.free
    case 'free-back': return lit.free
    case 'recalled': return lit.ctx
    case 'f-ui': return lit.findings.ui
    case 'f-code': return lit.findings.code
    case 'f-run': return lit.findings.run
    default: return false
  }
}

const horizontal = (s: Side): boolean => s === 'l' || s === 'r'

interface DrawnLink {
  def: LinkDef
  d: string
  lx: number
  ly: number
}

// Joins the points with straight runs and rounded corners (radius CORNER, less on a short run). Repeated or collinear points are harmless.
const CORNER = 8
function rounded(pts: Array<[number, number]>): string {
  const xy = (x: number, y: number) => `${+x.toFixed(1)} ${+y.toFixed(1)}`
  let d = `M${xy(pts[0]![0], pts[0]![1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!
    const [cx, cy] = pts[i]!
    const [nx, ny] = pts[i + 1]!
    const inLen = Math.hypot(cx - px, cy - py)
    const outLen = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(CORNER, inLen / 2, outLen / 2)
    if (r < 0.5) {
      d += `L${xy(cx, cy)}`
      continue
    }
    const a = [cx - ((cx - px) / inLen) * r, cy - ((cy - py) / inLen) * r] as const
    const b = [cx + ((nx - cx) / outLen) * r, cy + ((ny - cy) / outLen) * r] as const
    d += `L${xy(a[0], a[1])}Q${xy(cx, cy)} ${xy(b[0], b[1])}`
  }
  const last = pts[pts.length - 1]!
  return `${d}L${xy(last[0], last[1])}`
}

function route(stage: HTMLElement, defs: LinkDef[]): DrawnLink[] {
  const R = stage.getBoundingClientRect()
  const point = (key: string, side: Side, off: number): [number, number] | null => {
    const el = stage.querySelector(`[data-k="${key}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left - R.left
    const y = r.top - R.top
    return side === 'b' ? [x + r.width / 2 + off, y + r.height] : side === 't' ? [x + r.width / 2 + off, y] : side === 'l' ? [x, y + r.height / 2 + off] : [x + r.width, y + r.height / 2 + off]
  }
  const out: DrawnLink[] = []
  for (const def of defs) {
    const p = point(def.from, def.fromSide, def.fromOff)
    const q = point(def.to, def.toSide, def.toOff)
    if (!p || !q) continue
    let pts: Array<[number, number]>
    let lx = (p[0] + q[0]) / 2
    if (!horizontal(def.fromSide) && !horizontal(def.toSide)) {
      const m = (p[1] + q[1]) / 2
      pts = [p, [p[0], m], [q[0], m], q]
      if (def.tag === 'l' || def.tag === 'r') lx = p[0] + (def.tag === 'l' ? -6 : 6)
    } else if (horizontal(def.fromSide) && horizontal(def.toSide)) {
      const m = def.fromSide === def.toSide ? (def.fromSide === 'r' ? Math.max(p[0], q[0]) + 26 + (def.extra ?? 0) : Math.min(p[0], q[0]) - 26) : (p[0] + q[0]) / 2
      pts = [p, [m, p[1]], [m, q[1]], q]
      if (def.tag === 'turn') lx = m - 4
    } else if (horizontal(def.fromSide)) pts = [p, [q[0], p[1]], q]
    else if (def.drop !== undefined) {
      const m = q[0] + 26 + (def.extra ?? 0)
      pts = [p, [p[0], p[1] + def.drop], [m, p[1] + def.drop], [m, q[1]], q]
      if (def.tag === 'turn') lx = m - 4
    } else pts = [p, [p[0], q[1]], q]
    const d = rounded(pts)
    // delegate and back run side by side between the same two cards: push their labels apart so neither sits on the other's line.
    const nudge = def.id === 'delegate' && !def.tag ? 34 : def.id === 'back' && !def.tag ? -34 : 0
    out.push({ def, d, lx: lx + nudge, ly: (p[1] + q[1]) / 2 - (def.tag ? 0 : 4) })
  }
  return out
}

// Measures the stage once it is laid out and again when it changes size; which links are lit never needs a new measure.
function useRoutes(stage: RefObject<HTMLDivElement | null>, defs: LinkDef[]): DrawnLink[] {
  const [links, setLinks] = useState<DrawnLink[]>([])
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const draw = () => setLinks(route(el, defs))
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage, defs])
  return links
}

function LinkLines({ links, lit, motion }: { links: DrawnLink[]; lit: LinkLit; motion: boolean }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      {links.map(({ def, d, lx, ly }) => {
        const on = litOf(def.id, lit)
        const label = def.id === 'back' ? lit.backLabel : def.label
        const labelOn = def.id === 'f-ui' ? lit.findingsAny : on
        return (
          <g key={def.id} data-drawn={def.id} data-lit={on} style={cssVars(ACCENT[def.accent])}>
            {/* The marker sits inside this group so it reads the same --c as the line; one per link keeps the colours apart. */}
            <marker id={`og-head-${def.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1L9 5L0 9Z" className="og-head" data-lit={on} />
            </marker>
            <path d={d} className={cn('og-path', def.id === 'free' && 'og-dashed', motion && 'og-flow')} data-lit={on} markerEnd={`url(#og-head-${def.id})`} />
            {label && (
              <text
                x={lx}
                y={ly}
                textAnchor={def.tag === 'l' ? 'end' : def.tag === 'r' ? 'start' : 'middle'}
                dominantBaseline={def.tag === 'l' || def.tag === 'r' ? 'middle' : undefined}
                transform={def.tag === 'turn' ? `rotate(-90 ${lx} ${ly})` : undefined}
                className="og-text"
                data-lit={labelOn}
              >
                {label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// The drawn links are decorative; this list says the same in words for a screen reader.
function LinkWords({ defs, lit }: { defs: LinkDef[]; lit: LinkLit }) {
  return (
    <ul className="sr-only" aria-label="Links">
      {defs.filter((l) => l.label).map((l) => {
        const on = l.id === 'f-ui' ? lit.findingsAny : litOf(l.id, lit)
        return (
          <li key={l.id} data-link={l.id} data-lit={on}>{`${l.id === 'back' ? lit.backLabel : l.label}: ${on ? 'active' : 'idle'}`}</li>
        )
      })}
    </ul>
  )
}

// ---- compact: one tall column of small cards, the links in the side gutters and between the cards

function Compact({ g, lit, motion }: { g: OrchestrationGraph | null; lit: LinkLit; motion: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  const links = useRoutes(stage, TALL_LINKS)
  return (
    <div ref={stage} data-layout="compact" className="relative flex flex-col gap-[38px] px-[60px] py-1">
      <LinkLines links={links} lit={lit} motion={motion} />
      <Group name="ORCHESTRATOR" accent="green">
        <Orchestrator g={g} motion={motion} />
      </Group>
      <Group name="BRAIN" accent="purple">
        <Brain g={g} motion={motion} wide={false} />
      </Group>
      <Group name="MEMORY" accent="amber">
        <Recall g={g} motion={motion} />
      </Group>
      <Group name="BUILDER" accent="white">
        <Builder g={g} motion={motion} wide={false} />
      </Group>
      <Group name="COUNCIL" accent="green">
        <div className="grid grid-cols-3 gap-1.5">
          {COUNCIL.map((k) => (
            <CouncilCard key={k.key} g={g} k={k} motion={motion} wide={false} />
          ))}
        </div>
      </Group>
      <Group name="FREELANCER" accent="pink">
        <Freelancer g={g} motion={motion} />
      </Group>
      <LinkWords defs={TALL_LINKS} lit={lit} />
    </div>
  )
}

// ---- wide: two columns in dashed group boxes, with the links drawn between the measured cards

function Wide({ g, lit, motion }: { g: OrchestrationGraph | null; lit: LinkLit; motion: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  const links = useRoutes(stage, WIDE_LINKS)
  return (
    <div ref={stage} data-layout="wide" className="relative grid grid-cols-2 gap-x-[110px] gap-y-[44px] py-1 pr-[70px] pl-2">
      <LinkLines links={links} lit={lit} motion={motion} />
      <div className="flex flex-col gap-[44px]">
        <Group name="ORCHESTRATOR" accent="green">
          <Orchestrator g={g} motion={motion} />
        </Group>
        <Group name="BRAIN" accent="purple">
          <Brain g={g} motion={motion} wide />
        </Group>
        <Group name="LOADOUT" accent="white">
          <Loadout motion={motion} />
        </Group>
      </div>
      <div className="flex flex-col gap-[44px]">
        <Group name="MEMORY" accent="amber">
          <Recall g={g} motion={motion} />
        </Group>
        <Group name="BUILDER" accent="white">
          <Builder g={g} motion={motion} wide />
        </Group>
        <Group name="COUNCIL" accent="green">
          <div className="flex flex-col gap-1">
            {COUNCIL.map((k) => (
              <CouncilCard key={k.key} g={g} k={k} motion={motion} wide />
            ))}
          </div>
        </Group>
        <Group name="FREELANCER" accent="pink">
          <Freelancer g={g} motion={motion} />
        </Group>
      </div>
      <LinkWords defs={WIDE_LINKS} lit={lit} />
    </div>
  )
}

// ---- the whole graph

// The graph in the chosen size; with no choice, for a container of this width: compact below COMPACT_BELOW, wide above.
export function GraphAtWidth({ graph, width, motion, size }: { graph: OrchestrationGraph | null; width: number; motion: boolean; size?: GraphSize }) {
  const layout: Layout = layoutForSize(size, width)
  const lit = graphLinks(graph)
  const live = graphIsActive(graph)
  return (
    <section role="group" aria-label="Orchestration graph" data-testid="orchestration-graph" className="px-3 py-2.5">
      <div className="text-muted-foreground mb-2 flex justify-between text-[11px] tracking-[0.12em]">
        <span>ORCHESTRATION</span>
        <span className={live ? 'text-success' : undefined}>
          {live ? (
            <>
              <span aria-hidden className={cn(motion && 'og-blink')}>● </span>LIVE
            </>
          ) : (
            'IDLE'
          )}
        </span>
      </div>
      {layout === 'compact' ? <Compact g={graph} lit={lit} motion={motion} /> : <Wide g={graph} lit={lit} motion={motion} />}
    </section>
  )
}

function useMotionAllowed(): boolean {
  const [ok, setOk] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setOk(!mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return ok
}

// Picks the compact or the wide layout from the width of its own container (so a narrow side panel and a wide pop-out
// window each get the right one), and stops all movement when the person prefers reduced motion.
export function GraphView({ graph, size }: { graph: OrchestrationGraph | null; size?: GraphSize }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const motion = useMotionAllowed()
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="min-w-0">
      <GraphAtWidth graph={graph} width={width} motion={motion} size={size} />
    </div>
  )
}
