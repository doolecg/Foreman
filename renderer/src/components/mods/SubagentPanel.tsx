import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronLeft, MessageSquareText, MoreHorizontal, Square, X } from 'lucide-react'
import { decodeIpcError } from '@shared/ipc'
import { itemsOf, type ChatItem, type SubagentItem } from '@shared/claude-chat'
import type { ClaudeSubagent } from '@shared/mods'
import { cn } from '@/lib/utils'
import { bridge } from '@/lib/bridge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PixelBar, meterTone } from '@/components/ui/pixel-bar'
import { ConversationList } from '@/components/chat/ConversationList'
import { UserBubble } from '@/components/chat/ItemViews'
import { openAgentThread, selectAgent, useAgentSelection } from '@/components/chat/agentSelection'
import { ContextBar } from '@/components/chat/ItemViews'
import { agentElapsed, agentTitle, agentList, agentRowFor, kTokens, type AgentDot, type AgentRowModel } from '@/components/chat/chatHelpers'
import { chatActions, useChatState, useNow } from '@/components/chat/useChat'
import { Critter } from './agents/Critter'
import { GraphSection } from './agents/GraphSection'
import { useAgentItems } from './agents/useAgentItems'
import { cardTime, critterFor, effortInfo, loadCleared, loadStatusOpen, mcpSummary, mcpTiles, metricsOf, money, progressOf, saveCleared, saveStatusOpen, sessionRows, shortModel, skillSummary, skillTiles, stopPlan, summarize, viewFor, type AgentView, type EffortTone, type McpTile, type McpTone } from './agents/agentView'
import { SECTION } from './PanelRow'
import type { ModProps } from './registry'

const TONE: Record<EffortTone, { text: string }> = {
  success: { text: 'text-success' },
  info: { text: 'text-info' },
  warning: { text: 'text-warning' },
  destructive: { text: 'text-destructive' },
}

function StatusMark({ dot }: { dot: AgentDot }) {
  if (dot === 'done') return <Check role="img" aria-label="Done" className="text-success size-3.5 shrink-0" strokeWidth={3} />
  if (dot === 'failed') return <X role="img" aria-label="Failed" className="text-destructive size-3.5 shrink-0" strokeWidth={3} />
  if (dot === 'unknown') return <i role="img" aria-label="Stopped" className="bg-muted-foreground/60 size-[7px] shrink-0 rounded-full" />
  return <i role="img" aria-label={dot === 'waiting' ? 'Waiting for you' : 'Running'} className={cn('size-[8px] shrink-0 rounded-full', dot === 'waiting' ? 'bg-warning' : 'bg-primary motion-safe:animate-pulse')} />
}

function AgentRow({ row, now, onOpen, onClear, onStop, stopTitle }: { row: AgentView; now: number; onOpen: () => void; onClear?: () => void; onStop?: () => void; stopTitle?: string }) {
  const ms = agentElapsed(row, now)
  const critter = critterFor(row.id)
  const eff = effortInfo(row.effort)
  const model = shortModel(row.model)
  const prog = progressOf(row)
  const tone = TONE[eff?.tone ?? 'info']
  const open = row.dot === 'running' || row.dot === 'waiting'
  const metrics = metricsOf(row, ms)
  const kind = row.agentType && row.agentType !== row.description ? row.agentType : null
  const detail = [model, row.effort].filter(Boolean).join(' · ')
  const frac = prog.pct === null ? 0 : Math.min(100, prog.pct) / 100
  const busy = row.dot === 'waiting' ? 'warning' : 'primary'
  const barClass = 'mt-1'
  let bar: ReactNode = null
  if (open) {
    bar =
      prog.label && prog.pct !== null ? (
        <PixelBar className={barClass} fraction={frac} animate tone={busy} label={`Progress ${prog.label}`} />
      ) : (
        <PixelBar className={barClass} sweep tone={busy} label={row.dot === 'waiting' ? 'Waiting for you' : 'Running'} />
      )
  } else if (row.dot === 'done') {
    bar = <PixelBar className={barClass} solid tone="success" label="Done" />
  } else if (row.dot === 'failed') {
    bar = <PixelBar className={barClass} solid tone="destructive" label="Failed" />
  } else if (prog.pct !== null) {
    bar = <PixelBar className={barClass} fraction={frac} tone={meterTone(prog.pct, 75, 90)} label={prog.label ? `Progress ${prog.label}` : `Context ${Math.round(prog.pct)}% used`} />
  }
  return (
    <li className="group/row relative">
      <button type="button" onClick={onOpen} className={cn('hover:bg-accent m-press flex w-full items-start gap-3 rounded-[10px] px-3 py-3 text-left', onStop && 'pr-8')}>
        <Critter hat={critter.hat} tint={critter.tint} bob={open} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{row.description}</span>
            <StatusMark dot={row.dot} />
          </span>
          <span title={row.nameRef ?? undefined} className="text-muted-foreground/80 block truncate text-xs">{kind ? `${row.name} · ${kind}` : row.name}</span>
          {(eff || detail) && (
            <span className="block truncate text-xs">
              {eff && <span className={cn('font-medium', tone.text)}>{eff.word}</span>}
              {detail && (
                <span className="text-muted-foreground">
                  {eff ? ' ' : ''}
                  {detail}
                </span>
              )}
            </span>
          )}
          {(prog.label || metrics) && (
            <span className="text-muted-foreground mt-0.5 flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{prog.label ?? ''}</span>
              <span className="shrink-0 tabular-nums">{metrics}</span>
            </span>
          )}
          {bar}
        </span>
      </button>
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          aria-label={`Stop ${row.description}`}
          title={stopTitle ?? 'Stop this subagent'}
          className="text-muted-foreground hover:bg-muted hover:text-destructive absolute top-2 right-2 grid size-5 place-items-center rounded-full"
        >
          <Square className="size-2.5 fill-current" />
        </button>
      )}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${row.description}`}
          title="Clear"
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2 right-2 hidden size-5 place-items-center rounded-full group-hover/row:grid focus-visible:grid"
        >
          <X className="size-3" />
        </button>
      )}
    </li>
  )
}

// Cleared agents are hidden for this tile only (kept in localStorage); Claude and running agents are untouched.
function useCleared(tileId: number) {
  const [cleared, setCleared] = useState(() => loadCleared(tileId))
  const clear = (ids: string[]) =>
    setCleared((cur) => {
      const next = new Set(cur)
      for (const id of ids) next.add(id)
      saveCleared(tileId, next)
      return next
    })
  return { cleared, clear }
}

function AgentList({ tileId, views, now, onOpen, onStop }: { tileId: number; views: AgentView[]; now: number; onOpen: (id: string) => void; onStop: (scope: 'one' | 'turn', id: string) => Promise<void> }) {
  const { cleared, clear } = useCleared(tileId)
  const [stopError, setStopError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<{ id: string; title: string; body: string } | null>(null)
  const visible = views.filter((v) => !cleared.has(v.id))
  const running = visible.filter((v) => v.dot === 'running' || v.dot === 'waiting')
  const finished = visible.filter((v) => v.dot !== 'running' && v.dot !== 'waiting')
  const sum = summarize(visible, now)
  // The shelf of finished agents starts closed and opens when an agent runs; after that it stays as the user left it.
  const [shelfOpen, setShelfOpen] = useState(false)
  const anyRunning = running.length > 0
  useEffect(() => {
    if (anyRunning) setShelfOpen(true)
  }, [anyRunning])
  const runStop = (scope: 'one' | 'turn', id: string) => {
    setStopError(null)
    onStop(scope, id).catch((e) => setStopError(decodeIpcError(e).message))
  }
  const requestStop = (r: AgentView) => {
    const plan = stopPlan(r.canStopOne, running.filter((o) => o.id !== r.id).length)
    if (plan.confirm) setConfirmStop({ id: r.id, ...plan.confirm })
    else runStop(plan.scope, r.id)
  }
  return (
    <div className="shrink-0">
      {stopError && (
        <p role="alert" className="text-destructive surface-line border-t px-4 py-2 text-xs">
          {stopError}
        </p>
      )}
      <ConfirmDialog
        open={confirmStop !== null}
        title={confirmStop?.title ?? ''}
        description={confirmStop?.body ?? ''}
        confirmLabel="Stop turn"
        danger
        onConfirm={() => {
          if (confirmStop) runStop('turn', confirmStop.id)
          setConfirmStop(null)
        }}
        onCancel={() => setConfirmStop(null)}
      />
      {visible.length === 0 ? (
        <p className={cn(SECTION, 'text-muted-foreground py-3 text-[13px]')}>{views.length > 0 ? 'All agents cleared.' : 'No agents in this session yet.'}</p>
      ) : (
        <>
          <p className={cn(SECTION, 'text-muted-foreground truncate px-4 py-2.5 text-xs tabular-nums')}>
            {[`${visible.length} ${visible.length === 1 ? 'agent' : 'agents'}`, sum.cost !== null ? money(sum.cost) : '—', `${sum.tokens !== null ? kTokens(sum.tokens) : '—'} tokens`, sum.ms !== null ? cardTime(sum.ms) : '—'].join('  ·  ')}
          </p>
          <section className={SECTION}>
            <div className="flex items-center gap-1 px-1 pt-1 pb-1.5">
              <span className="text-muted-foreground text-[13px] font-medium">Agents ({visible.length})</span>
              <span className="flex-1" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Agent actions" className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring grid size-6 place-items-center rounded-full outline-none focus-visible:ring-2">
                    <MoreHorizontal aria-hidden className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={finished.length === 0} onSelect={() => clear(finished.map((f) => f.id))}>
                    Clear finished
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {running.length > 0 && (
              <ul aria-label="Running" className="flex flex-col gap-1">
                {running.map((r) => (
                  <AgentRow key={r.id} row={r} now={now} onOpen={() => onOpen(r.id)} onStop={() => requestStop(r)} stopTitle={stopPlan(r.canStopOne, 0).title} />
                ))}
              </ul>
            )}
            {finished.length > 0 && (
              <>
                <button type="button" onClick={() => setShelfOpen((o) => !o)} aria-expanded={shelfOpen} className="text-muted-foreground hover:bg-accent m-press mt-1 flex w-full items-center gap-3 rounded-[10px] px-1 py-2 text-[13px]">
                  <span className="shrink-0">Previous agents ({finished.length})</span>
                  <span aria-hidden className="h-px flex-1 bg-(--surface-line)" />
                  <ChevronDown className={cn('size-4 shrink-0 transition-transform', !shelfOpen && '-rotate-90')} aria-hidden />
                </button>
                {shelfOpen && (
                  <ul aria-label="Finished" className="m-enter flex flex-col gap-1">
                    {finished.map((r) => (
                      <AgentRow key={r.id} row={r} now={now} onOpen={() => onOpen(r.id)} onClear={() => clear([r.id])} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

// One agent's conversation in the panel, in the same calm style at 13 px: its prompt, tools and replies, live.
function AgentConversation({ scratchId, agent, live, onBack, onOpenInChat, fromTranscript }: { scratchId: number; agent: AgentRowModel & { prompt: string }; live: ChatItem[]; onBack: () => void; onOpenInChat?: () => void; fromTranscript?: boolean }) {
  const running = agent.dot === 'running' || agent.dot === 'waiting'
  const items = useAgentItems(scratchId, agent.id, running, live, fromTranscript)
  const box = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  useLayoutEffect(() => {
    const el = box.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [items])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-2.5 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[13px]">
            <ChevronLeft className="size-3.5" aria-hidden /> Agents
          </button>
          {onOpenInChat && (
            <button type="button" onClick={onOpenInChat} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px]">
              <MessageSquareText className="size-3.5" aria-hidden /> Open in chat
            </button>
          )}
        </div>
        <div className="mt-1 truncate text-[13px] font-semibold">{agentTitle(agent)}</div>
        {agent.context && <ContextBar ctx={agent.context} />}
        {agent.description && agent.description !== (agent.agentType || '') && <div className="text-muted-foreground truncate text-xs">{agent.description}</div>}
      </div>
      <div
        ref={box}
        role="log"
        aria-label={`Conversation of ${agent.description}`}
        onScroll={(e) => {
          const el = e.currentTarget
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-2 pb-4"
      >
        {agent.prompt && (
          <div className="flex justify-end">
            <UserBubble item={{ kind: 'user', id: `${agent.id}:prompt`, parent: agent.id, text: agent.prompt, images: [], queued: false, at: 0 }} small />
          </div>
        )}
        <ConversationList scratchId={scratchId} items={items} onOpenAgent={() => {}} onTerminal={() => {}} small prompts={false} />
        {items.length === 0 && <p className="text-muted-foreground text-xs">{running ? 'Waiting for the agent…' : 'No conversation is available for this agent.'}</p>}
      </div>
    </div>
  )
}

const subagentsOf = (items: ChatItem[]): SubagentItem[] => items.filter((i): i is SubagentItem => i.kind === 'subagent')

// Chat tiles: the agents come from the chat stream.
function ChatAgents({ tileId }: { tileId: number }) {
  const state = useChatState(tileId)
  const sel = useAgentSelection(tileId)
  const anyOpen = !!state?.items.some((i) => i.kind === 'subagent' && (i.status === 'running' || i.status === 'waiting'))
  const now = useNow(anyOpen)
  const views = useMemo(() => {
    const items = state?.items ?? []
    const byId = new Map(items.filter((i): i is SubagentItem => i.kind === 'subagent').map((i) => [i.id, i]))
    const { shown, earlier } = agentList(items, now)
    return [...shown, ...earlier].map((r) => viewFor(r, byId.get(r.id) ?? null, items))
  }, [state?.items, now])
  const open = sel.agent ? state?.items.find((i): i is SubagentItem => i.kind === 'subagent' && i.id === sel.agent) : undefined
  if (!state) return <p className="text-muted-foreground px-4 py-3 text-[13px]">Loading…</p>
  if (open) return <AgentConversation scratchId={tileId} agent={{ ...agentRowFor(open), prompt: open.prompt }} live={itemsOf(state, open.id)} onBack={() => selectAgent(tileId, null)} onOpenInChat={() => openAgentThread(tileId, subagentsOf(state.items), open.id)} />
  const stop = async (scope: 'one' | 'turn', id: string) => {
    if (scope === 'one') await bridge().invoke('chat:stopAgent', tileId, id)
    else chatActions.interrupt(tileId)
  }
  return <AgentList tileId={tileId} views={views} now={now} onOpen={(id) => selectAgent(tileId, id)} onStop={stop} />
}

const HOOK_DOT: Record<ClaudeSubagent['status'], AgentDot> = { running: 'running', completed: 'done', failed: 'failed', stopped: 'unknown', unknown: 'unknown' }

const hookRow = (a: ClaudeSubagent): AgentRowModel => ({
  id: a.agentId,
  description: a.description ?? a.agentType ?? 'Agent',
  dot: HOOK_DOT[a.status],
  now: a.status === 'running' ? (a.agentType ?? '') : a.status === 'completed' ? 'Done' : a.status === 'failed' ? 'Failed' : '',
  tldr: a.status === 'running' ? 'Working…' : a.status === 'completed' ? 'Done' : a.status === 'failed' ? 'Failed' : '',
  context: null,
  startedAt: a.startedAt ?? null,
  endedAt: a.endedAt ?? null,
  agentType: a.agentType,
  model: a.model ?? null,
})

// Terminal tiles: the same list from the hook events; the conversation is read from the agent's transcript.
function HookAgents({ tileId, agents }: { tileId: number; agents: ClaudeSubagent[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const running = agents.some((a) => a.status === 'running')
  const now = useNow(running)
  const rows = useMemo(() => agents.map(hookRow).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)), [agents])
  const views = useMemo(() => rows.map((r) => viewFor(r, null, [])), [rows])
  const open = rows.find((r) => r.id === openId)
  if (open) return <AgentConversation scratchId={tileId} agent={{ ...open, prompt: '' }} live={[]} fromTranscript onBack={() => setOpenId(null)} />
  // A PTY running Claude has no per-agent control: Escape interrupts the whole turn, so the button says so.
  const stop = async () => {
    await bridge().invoke('scratch:write', tileId, '')
  }
  return <AgentList tileId={tileId} views={views} now={now} onOpen={setOpenId} onStop={stop} />
}

const MCP_DOT: Record<McpTone, string> = { success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive', muted: 'bg-muted-foreground/50' }
const MCP_TEXT: Record<McpTone, string> = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' }

// The MCP servers and skills: one row each (dot, name, state word), the same look for both. Attention only colours the dot and the word.
function StatusTiles({ label, tiles }: { label: string; tiles: McpTile[] }) {
  return (
    <div>
      <div className="text-muted-foreground px-1 pt-1 pb-1.5 text-[13px] font-medium">{label}</div>
      <ul className="flex flex-col gap-0.5">
        {tiles.map((t) => (
          <li key={t.name} title={t.reason ? `${t.name} · ${t.reason}` : t.name} className="flex min-w-0 items-center gap-3 rounded-[10px] px-1 py-1.5 text-[13px]">
            <span className="grid size-4 shrink-0 place-items-center">
              <i role="img" aria-label={t.state} className={cn('size-[7px] rounded-full', MCP_DOT[t.tone])} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {t.prefix && <span className="text-muted-foreground font-normal">{t.prefix}:</span>}
              {t.short}
            </span>
            <span className={cn('shrink-0 text-xs', t.attention ? MCP_TEXT[t.tone] : 'text-muted-foreground')}>{t.state}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Soft Status section at the foot of the panel: MCP servers, skills loaded, and the SessionStart hook messages (moved out of the chat).
function StatusSection({ tileId, chat }: { tileId: number; chat?: boolean }) {
  const state = useChatState(chat ? tileId : null)
  const [open, setOpen] = useState(loadStatusOpen)
  const toggle = () =>
    setOpen((o) => {
      saveStatusOpen(!o)
      return !o
    })
  const servers = state?.mcpServers ?? []
  const session = useMemo(() => sessionRows(state?.items ?? []), [state?.items])
  const tiles = mcpTiles(servers)
  const skills = useMemo(() => skillTiles(state?.items ?? []), [state?.items])
  const bad = tiles.some((t) => t.tone === 'destructive')
  return (
    <section className="surface-line mt-auto shrink-0 border-t">
      <button type="button" onClick={toggle} aria-expanded={open} className="hover:bg-accent m-press flex w-full items-center gap-1.5 px-4 py-3 text-left text-[13px] font-medium">
        <ChevronDown className={cn('text-muted-foreground size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
        Status
        {!open && bad && <i aria-label="A server failed" className="bg-destructive size-[6px] rounded-full" />}
      </button>
      {open && (
        <div className="px-3 pb-3">
          {!chat ? (
            <p className="text-muted-foreground text-xs">Available in Chat view.</p>
          ) : (
            <>
              {servers.length > 0 && <StatusTiles label={mcpSummary(servers)} tiles={tiles} />}
              {skills.length > 0 && <div className={servers.length > 0 ? 'mt-3' : undefined}><StatusTiles label={skillSummary(skills)} tiles={skills} /></div>}
              {session.length > 0 && (
                <div className={servers.length > 0 || skills.length > 0 ? 'mt-3' : undefined}>
                  <div className="text-muted-foreground px-1 pt-1 pb-1.5 text-[13px] font-medium">Session</div>
                  <ul className="flex flex-col gap-1">
                    {session.map((r, i) => (
                      <li key={i} className="px-1 py-1.5 text-xs leading-snug">
                        <span className="text-muted-foreground block text-[11px]">{r.origin}</span>
                        {r.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {servers.length === 0 && skills.length === 0 && session.length === 0 && <p className="text-muted-foreground text-xs">Nothing to report.</p>}
            </>
          )}
        </div>
      )}
    </section>
  )
}

// The Agents panel: summary cards and the tile's agents as critters (running, then finished; finished ones can be cleared);
// a click opens that agent's conversation inside the panel. Observation only: it never starts or stops anything.
export function SubagentPanel({ tileId, crewId, state, chat, onCollapse }: ModProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-2.5 pl-4">
        <h3 className="text-[13px] font-semibold">Agents</h3>
        <span className="flex-1" />
        <button type="button" onClick={onCollapse} aria-label="Hide Agents panel" title="Hide" className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-7 place-items-center rounded-full">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <GraphSection tileId={tileId} crewId={crewId} chat={!!chat} />
        {chat ? <ChatAgents tileId={tileId} /> : <HookAgents tileId={tileId} agents={state?.subagents ?? []} />}
        <StatusSection tileId={tileId} chat={chat} />
      </div>
    </div>
  )
}
