import { useEffect, useRef, useState } from 'react'
import { Bot, Files, ListChecks, type LucideIcon } from 'lucide-react'
import { useCapabilities, useClaudeTileState, useSettings } from '@/lib/queries'
import { useTaskPlan } from '@/lib/queries/engineering'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { useAgentSelection } from '@/components/chat/agentSelection'
import { FilesPanel } from '@/components/plans/FilesPanel'
import { PlanPanel } from '@/components/plans/PlanPanel'
import { cn } from '@/lib/utils'
import { ModBoundary } from './ModBoundary'
import { WIDEN_PANEL } from './agents/graphModel'
import type { ModId } from '@shared/mods'
import { MODS } from './registry'

const WIDTH_KEY = 'foreman.subagentPanelWidth'
const TAB_KEY = 'foreman.railTab'
const DEFAULT_WIDTH = 400
// The most the panel may take: wide enough for the graph's Large view, but never so wide the chat is squeezed out.
const maxWidth = (): number => Math.max(560, Math.min(900, window.innerWidth - 480))

type Tab = 'plan' | 'files' | 'agents'

// localStorage can be missing or full; the panel then keeps its defaults.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

function RailButton({ label, icon: Icon, on, dot, onClick }: { label: string; icon: LucideIcon; on: boolean; dot?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn('m-press relative grid size-9 place-items-center rounded-[10px] outline-none focus-visible:ring-2', on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
    >
      <Icon className="size-[18px]" aria-hidden />
      {dot && <i aria-hidden className={cn('bg-warning absolute top-1 right-1 size-2.5 rounded-full border-2', on ? 'border-accent' : 'border-sidebar')} />}
    </button>
  )
}

// The right rail of a thread: Plan (while Engineering Mode is on), Files and Agents as icons; a click opens that panel beside the rail, another closes it.
// Only Foreman's own panels live here: native mods draw inside Claude Code. The frame (width and the open tab, kept in localStorage) is the host's;
// a crash in the Agents panel stays inside its ModBoundary.
export function ModsHost({ tileId, crewId, chat, engineering }: { tileId: number; crewId: number | null; chat?: boolean; engineering?: boolean }) {
  const settings = useSettings().data
  const caps = useCapabilities().data
  const state = useClaudeTileState(tileId).data ?? null
  const plan = useTaskPlan(engineering ? crewId : null).data
  const [width, setWidth] = useState(() => Number(readStored(WIDTH_KEY)) || DEFAULT_WIDTH)
  const [tab, setTab] = useState<Tab | null>(() => (readStored(TAB_KEY) as Tab | null) || null)
  const panel = useRef<HTMLElement>(null)
  // The cap follows the window, so shrinking the window never leaves the panel squeezing the chat.
  const [cap, setCap] = useState(maxWidth)
  useEffect(() => {
    const on = () => setCap(maxWidth())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  // Opening an agent from the chat opens the Agents panel.
  const opened = useAgentSelection(tileId).nonce
  const seen = useRef(opened)
  useEffect(() => {
    if (opened <= seen.current) return
    seen.current = opened
    setTab('agents')
    writeStored(TAB_KEY, 'agents')
  }, [opened])
  // The graph's Large view asks for a wider panel (or Small for the usual one); the width is kept like a drag would.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ tileId: number; width: number | null }>).detail
      if (d.tileId !== tileId) return
      const to = Math.round(Math.min(d.width ?? DEFAULT_WIDTH, maxWidth()))
      setWidth(to)
      writeStored(WIDTH_KEY, String(to))
    }
    window.addEventListener(WIDEN_PANEL, on)
    return () => window.removeEventListener(WIDEN_PANEL, on)
  }, [tileId])
  const mod = settings?.mods.enabled ? MODS.find((m) => m.kind === 'panel' && m.component && settings.mods.mods[m.id as ModId]) : undefined
  const tabs: Tab[] = [...(engineering ? (['plan'] as const) : []), ...(crewId !== null ? (['files'] as const) : []), ...(mod?.component ? (['agents'] as const) : [])]
  if (!settings || tabs.length === 0) return null
  const shown = tab !== null && tabs.includes(tab) ? tab : null
  function pick(next: Tab) {
    setTab((cur) => {
      const to = cur === next ? null : next
      writeStored(TAB_KEY, to ?? '')
      return to
    })
  }
  const Panel = mod?.component
  const a = chat || !mod ? { available: true } : (mod.isAvailable?.(caps) ?? { available: true })

  return (
    <>
      {shown && (
        <aside
          ref={panel}
          aria-label={shown === 'agents' ? `Mods: ${mod?.title} panel` : shown === 'plan' ? 'Plan panel' : 'Files panel'}
          data-testid="subagent-panel"
          className="m-panel surface relative my-1.5 flex min-h-0 shrink-0 flex-col overflow-hidden text-xs"
          style={{ width: Math.min(width, cap) }}
        >
          <ResizeHandle
            target={panel}
            axis="x"
            grow={-1}
            min={280}
            max={cap}
            label="Resize side panel"
            className="left-0"
            onResize={setWidth}
            onCommit={(px) => (setWidth(px), writeStored(WIDTH_KEY, String(px)))}
            onReset={() => (setWidth(DEFAULT_WIDTH), writeStored(WIDTH_KEY, String(DEFAULT_WIDTH)))}
          />
          {shown === 'plan' && <PlanPanel crewId={crewId} />}
          {shown === 'files' && <FilesPanel crewId={crewId} />}
          {shown === 'agents' && Panel && (
            <ModBoundary title={mod!.title}>
              {a.available ? (
                <Panel tileId={tileId} crewId={crewId} state={state} settings={settings} chat={chat} onCollapse={() => pick('agents')} />
              ) : (
                <p className="text-muted-foreground p-3 text-xs">
                  <span className="font-medium">{mod!.title}</span> is unavailable: {a.reason}.
                </p>
              )}
            </ModBoundary>
          )}
        </aside>
      )}
      <nav aria-label="Side panels" className="flex w-11 shrink-0 flex-col items-center gap-1 pt-3">
        {tabs.includes('plan') && <RailButton label="Plan" icon={ListChecks} on={shown === 'plan'} dot={plan?.gate === 'waiting'} onClick={() => pick('plan')} />}
        {tabs.includes('files') && <RailButton label="Files" icon={Files} on={shown === 'files'} onClick={() => pick('files')} />}
        {tabs.includes('agents') && <RailButton label="Agents" icon={Bot} on={shown === 'agents'} onClick={() => pick('agents')} />}
      </nav>
    </>
  )
}
