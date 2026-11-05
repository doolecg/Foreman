import { useEffect, useState } from 'react'
import { Maximize2, Minimize2, PictureInPicture2 } from 'lucide-react'
import { decodeIpcError } from '@shared/ipc'
import { isGraphOut } from '@shared/graph-popout'
import type { GraphSubagent, OrchestrationGraph } from '@shared/orchestration-graph'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { call, useCrews, useGraphPopouts, useLiveUpdates, useOrchestrationGraph } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { SECTION } from '../PanelRow'
import { GraphView } from './GraphView'
import { RightNowCard } from './RightNowCard'
import { loadGraphSize, loadPanelView, saveGraphSize, savePanelView, LARGE_PANEL_WIDTH, WIDEN_PANEL, type GraphPlace, type GraphSize, type PanelView } from './graphModel'

function ViewSwitch({ view, onChange }: { view: PanelView; onChange: (v: PanelView) => void }) {
  const btn = (v: PanelView, text: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => onChange(v)}
      className={cn('focus-visible:ring-ring rounded-full px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2', view === v ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
    >
      {text}
    </button>
  )
  return (
    <div role="group" aria-label="Right now view" className="flex items-center gap-0.5">
      {btn('list', 'List')}
      {btn('graph', 'Graph')}
    </div>
  )
}

// Small (one narrow column) or Large (two columns, wider). Kept per project, separately for the panel and the pop-out.
export function useGraphSize(place: GraphPlace, crewId: number | null): [GraphSize, (s: GraphSize) => void] {
  const [size, setSize] = useState<GraphSize>(() => (crewId !== null ? loadGraphSize(place, crewId) : 'small'))
  useEffect(() => setSize(crewId !== null ? loadGraphSize(place, crewId) : 'small'), [place, crewId])
  const pick = (s: GraphSize) => {
    setSize(s)
    if (crewId !== null) saveGraphSize(place, crewId, s)
  }
  return [size, pick]
}

function SizeButton({ size, onChange }: { size: GraphSize; onChange: (s: GraphSize) => void }) {
  const large = size === 'large'
  const Icon = large ? Minimize2 : Maximize2
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Large view" aria-pressed={large} title={large ? 'Back to the small view' : 'Large view'} onClick={() => onChange(large ? 'small' : 'large')}>
      <Icon aria-hidden className="size-3.5" />
    </Button>
  )
}

// What the panel shows in place of the graph while it sits in its own window.
function PoppedOutNotice({ onPopIn }: { onPopIn: () => void }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 px-3 py-6 text-xs">
      <p>The graph is in its own window.</p>
      <Button type="button" variant="outline" size="sm" onClick={onPopIn}>
        Pop back in
      </Button>
    </div>
  )
}

// A load or error line instead of the graph, so a graph that is not there yet never looks like an idle one.
function GraphLoad({ q, graph, size }: { q: { isLoading: boolean; isError: boolean }; graph: OrchestrationGraph | null; size: GraphSize }) {
  if (q.isLoading) return <p className="text-muted-foreground px-3 py-4 text-xs">Loading…</p>
  if (q.isError) return <p role="alert" className="text-destructive px-3 py-4 text-xs">Couldn't load the graph</p>
  return <GraphView graph={graph} size={size} />
}

const failed = (e: unknown) => toast(decodeIpcError(e).message, true)

// The top of the Agents panel. With Orchestration on, a List | Graph switch (kept per project) chooses between the
// "Right now" card and the Orchestration graph; the sub-agent list under it is the same in both.
export function GraphSection({ tileId, crewId, chat }: { tileId: number; crewId: number | null; chat: boolean }) {
  const crew = useCrews().data?.find((c) => c.id === crewId)
  const on = !!crew?.factory && crewId !== null
  const [view, setView] = useState<PanelView>(() => (crewId !== null ? loadPanelView(crewId) : 'list'))
  useEffect(() => setView(crewId !== null ? loadPanelView(crewId) : 'list'), [crewId])
  const showGraph = on && view === 'graph'
  const q = useOrchestrationGraph(showGraph ? crewId : null)
  const graph = q.data ?? null
  const out = isGraphOut(useGraphPopouts().data, crewId ?? -1)
  const [size, setSize] = useGraphSize('panel', crewId)
  // Large needs room, so choosing it widens the side panel (ModsHost listens); Small puts it back to its usual width. Only this tile's panel hears it.
  const pickSize = (s: GraphSize) => {
    setSize(s)
    window.dispatchEvent(new CustomEvent(WIDEN_PANEL, { detail: { tileId, width: s === 'large' ? LARGE_PANEL_WIDTH : null } }))
  }
  const pick = (v: PanelView) => {
    setView(v)
    if (crewId !== null) savePanelView(crewId, v)
  }
  const popOut = () => void call('graph:popOut', crewId!).catch(failed)
  const popIn = () => void call('graph:popIn', crewId!).catch(failed)
  return (
    <>
      {on && (
        <div className={cn(SECTION, 'flex items-center justify-between gap-2')}>
          <ViewSwitch view={view} onChange={pick} />
          {showGraph && !out && (
            <span className="flex items-center">
              <SizeButton size={size} onChange={pickSize} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Pop the graph out" title="Pop out into its own window" onClick={popOut}>
                <PictureInPicture2 aria-hidden className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
      )}
      {showGraph ? out ? <PoppedOutNotice onPopIn={popIn} /> : <GraphLoad q={q} graph={graph} size={size} /> : <RightNowCard tileId={tileId} crewId={crewId} chat={chat} />}
    </>
  )
}

const DOT: Record<GraphSubagent['status'], string> = { running: 'bg-primary', completed: 'bg-success', failed: 'bg-destructive', stopped: 'bg-muted-foreground/60', unknown: 'bg-muted-foreground/60' }
const STATUS_WORD: Record<GraphSubagent['status'], string> = { running: 'Running', completed: 'Done', failed: 'Failed', stopped: 'Stopped', unknown: 'Stopped' }

// The sub-agents of the graph's session, newest first, for the pop-out window (the panel has its own richer list).
function GraphSubagents({ agents }: { agents: GraphSubagent[] }) {
  return (
    <section aria-label="Subagents" className="surface-line border-t px-3 py-2">
      <h2 className="text-muted-foreground pb-1.5 text-[13px] font-medium">Agents ({agents.length})</h2>
      {agents.length === 0 ? (
        <p className="text-muted-foreground text-xs">No agents in this session yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {[...agents].reverse().map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-2.5 py-1 text-[13px]">
              {a.status === 'completed' || a.status === 'failed' ? (
                <span role="img" aria-label={STATUS_WORD[a.status]} className={cn('w-3 shrink-0 text-center text-xs font-bold', a.status === 'failed' ? 'text-destructive' : 'text-success')}>
                  {a.status === 'failed' ? '✖' : '✓'}
                </span>
              ) : (
                <i role="img" aria-label={STATUS_WORD[a.status]} className={cn('size-[8px] shrink-0 rounded-full', DOT[a.status], a.status === 'running' && 'motion-safe:animate-pulse')} />
              )}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{a.name}</span>
                {a.doing && <span className="text-muted-foreground"> · {a.doing}</span>}
              </span>
              {a.model && <span className="text-muted-foreground shrink-0 text-xs">{a.model}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// The whole content of a graph pop-out window (main.tsx renders it when the URL has ?graphPopout=<crewId>): a thin bar
// with the way back, the graph and the sub-agents. It reads the same pushed state as the panel.
export function GraphPopoutPage({ crewId }: { crewId: number }) {
  useLiveUpdates()
  const q = useOrchestrationGraph(crewId)
  const graph = q.data ?? null
  const [size, setSize] = useGraphSize('popout', crewId)
  return (
    <div className="bg-background text-foreground flex h-screen flex-col p-2">
      <div className="flex shrink-0 items-center justify-end gap-1 pb-1">
        <SizeButton size={size} onChange={setSize} />
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void call('graph:popIn', crewId).catch(failed)}>
          <PictureInPicture2 aria-hidden className="size-3.5" />
          Pop back in
        </Button>
      </div>
      <div className="surface-edge bg-card min-h-0 flex-1 overflow-y-auto rounded-[18px]">
        <GraphLoad q={q} graph={graph} size={size} />
        <GraphSubagents agents={graph?.subagents ?? []} />
      </div>
    </div>
  )
}
