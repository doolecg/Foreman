import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown } from 'lucide-react'
import type { SubagentItem } from '@shared/claude-chat'
import { validPath } from '@shared/chat-lineage'
import { historyLines } from '@shared/chat-history-lines'
import { cliBlocked } from '@/lib/capabilities'
import { useCapabilities } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { AgentThread } from './AgentThread'
import { Composer } from './Composer'
import { HistoryStrip } from './HistoryStrip'
import { FactoryChip } from './FactoryBox'
import { StageChip } from './StageBox'
import { ConversationList } from './ConversationList'
import { StatusLine } from './StatusLine'
import { TaskList } from './TaskList'
import { capItems, findMatches, mainThread } from './chatHelpers'
import { DiffPanel, type DiffTarget } from './DiffPanel'
import { DIFF_PANEL_EVENT, DIFF_STATE_EVENT, type DiffPanelDetail, type DiffStateDetail } from './diffModel'
import { FindBar } from './FindBar'
import { openAgentThread, useAgentThread } from './agentSelection'
import { chatActions, useChatState } from './useChat'

const RENDER_CAP = 300
const NEAR_BOTTOM = 80
const FOLLOW_MS = 120

interface Props {
  scratchId: number
  // The effort the tile was launched with ("Default" in the effort popover).
  launchEffort: string | null
  // The tile's saved model (pending until Claude reports one).
  tileModel: string | null
  // Switches the tile to the Terminal view.
  onTerminal: () => void
  // Names for the breadcrumbs when an agent's conversation is open.
  projectName?: string | null
  threadTitle?: string
  // The project, for the Engineering stage box (shown when `engineering` is on).
  crewId?: number
  engineering?: boolean
  factory?: boolean
  // The stage and Factory chips on top of the chat; off when the thread header shows them.
  chips?: boolean
}

// The Chat view of a Claude tile: the conversation (Claude's text on the background, owner messages as soft bubbles,
// tools as quiet rows, one bordered card per prompt), the running status line and the composer.
export function ChatView({ scratchId, launchEffort, tileModel, onTerminal, projectName = null, threadTitle = 'Chat', crewId, engineering = false, factory = false, chips = true }: Props) {
  const state = useChatState(scratchId)
  const caps = useCapabilities().data
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [limit, setLimit] = useState(RENDER_CAP)
  const [loading, setLoading] = useState(false)

  const items = state?.items
  const thread = useAgentThread(scratchId)
  const agents = useMemo(() => items?.filter((i): i is SubagentItem => i.kind === 'subagent') ?? [], [items])
  const path = useMemo(() => validPath(agents, thread.path), [agents, thread.path])
  const current = path.length > 0 ? agents.find((a) => a.id === path[path.length - 1]) : undefined
  const returning = useRef(false)
  const lastTop = useRef(0)
  if (current) returning.current = true
  const main = useMemo(() => (items ? mainThread(items) : []), [items])
  const capped = useMemo(() => capItems(main, limit), [main, limit])
  const lines = useMemo(() => historyLines(capped.items), [capped.items])
  const strip = lines.length > 0

  // Find in thread: matches come from every loaded item, the highlights from the rows that are on screen.
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const revealNext = useRef(false)
  const findFrom = useRef<HTMLElement | null>(null)
  const matches = useMemo(() => (findOpen ? findMatches(main, query) : []), [findOpen, main, query])
  const match = matches[Math.min(active, matches.length - 1)]
  const activeNo = match ? matches.indexOf(match) : -1
  const startFind = () => {
    if (!findOpen) findFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFindOpen(true)
  }
  const closeFind = () => {
    setFindOpen(false)
    findFrom.current?.focus()
  }
  const setFindQuery = (q: string) => {
    revealNext.current = true
    setQuery(q)
    setActive(0)
  }
  const stepFind = (dir: 1 | -1) => {
    if (matches.length === 0) return
    revealNext.current = true
    setActive((activeNo + dir + matches.length) % matches.length)
  }
  // A match in items the render cap left out: widen the window to include it.
  useLayoutEffect(() => {
    if (!match) return
    const at = main.findIndex((i) => i.id === match.id)
    if (at >= 0 && at < main.length - limit) setLimit(main.length - at)
  }, [match?.id, match?.index, main, limit])
  // Paint the hits with the CSS Custom Highlight API (no change to the row components), then bring the active one into view.
  useEffect(() => {
    const root = scroller.current
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    if (!registry || typeof Highlight === 'undefined') return
    registry.delete('find-hit')
    registry.delete('find-active')
    if (!root || !findOpen || !query.trim()) return
    const q = query.toLowerCase()
    const hits: Range[] = []
    let current: Range | null = null
    for (const el of root.querySelectorAll<HTMLElement>('[data-item-id]')) {
      let n = 0
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.nodeValue ?? '').toLowerCase()
        for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) {
          const r = new Range()
          r.setStart(node, at)
          r.setEnd(node, at + q.length)
          if (match && el.dataset.itemId === match.id && n === match.index) current = r
          hits.push(r)
          n++
        }
      }
    }
    registry.set('find-hit', new Highlight(...hits))
    if (current) registry.set('find-active', new Highlight(current))
    if (revealNext.current) {
      revealNext.current = false
      const target = (current as Range | null)?.startContainer.parentElement ?? root.querySelector(`[data-item-id="${CSS.escape(match?.id ?? '')}"]`)
      if (target) {
        stuck.current = false
        target.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
    }
  })
  useEffect(
    () => () => {
      const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
      registry?.delete('find-hit')
      registry?.delete('find-active')
    },
    [],
  )

  // The diff panel: opened by the changed-files card (with the file clicked) and the header button (toggle).
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null)
  // The element that had focus when the panel opened (the header button, or a file in the changed-files card); closing returns focus to it.
  const diffOpener = useRef<HTMLElement | null>(null)
  const diffOpenRef = useRef(false)
  diffOpenRef.current = diffOpen
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<DiffPanelDetail>).detail
      if (d.scratchId !== scratchId) return
      if (!diffOpenRef.current) diffOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (d.toggle) return setDiffOpen((o) => !o)
      setDiffTarget({ path: d.path, nonce: performance.now() })
      setDiffOpen(true)
    }
    window.addEventListener(DIFF_PANEL_EVENT, onOpen)
    return () => window.removeEventListener(DIFF_PANEL_EVENT, onOpen)
  }, [scratchId])
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<DiffStateDetail>(DIFF_STATE_EVENT, { detail: { scratchId, open: diffOpen } }))
  }, [scratchId, diffOpen])
  const closeDiff = () => {
    setDiffOpen(false)
    diffOpener.current?.focus()
  }

  const toBottom = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Growth while the owner is near the bottom glides there, at most once per FOLLOW_MS; a long way down (opening the chat) or reduced motion snaps.
  const glideAt = useRef(0)
  const glideTimer = useRef<number | undefined>(undefined)
  const glideUntil = useRef(0)
  const follow: () => void = useCallback(() => {
    const el = scroller.current
    if (!el || !stuck.current) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return toBottom()
    const wait = FOLLOW_MS - (performance.now() - glideAt.current)
    if (wait > 0) {
      glideTimer.current ??= window.setTimeout(() => {
        glideTimer.current = undefined
        follow()
      }, wait)
      return
    }
    glideAt.current = performance.now()
    glideUntil.current = glideAt.current + 400
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [toBottom])
  useEffect(() => () => window.clearTimeout(glideTimer.current), [])

  // Follow the newest content while the owner has not scrolled away.
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(follow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [follow, state === null, !current])
  useLayoutEffect(() => {
    if (stuck.current) follow()
  }, [items, follow, !current])
  // Coming back from an agent: the scroll position it was left at.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && !stuck.current) el.scrollTop = lastTop.current
  }, [!current])
  useEffect(() => {
    if (!current) returning.current = false
  })

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    lastTop.current = el.scrollTop
    // Growth during a glide can put the bottom more than NEAR_BOTTOM away; that is not the owner scrolling off.
    if (near || performance.now() > glideUntil.current) stuck.current = near
    setAtBottom(near)
  }
  const leaveGlide = () => (glideUntil.current = 0)
  const jump = () => {
    stuck.current = true
    setAtBottom(true)
    glideUntil.current = performance.now() + 1000
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  const loadEarlier = async () => {
    if (capped.hidden > 0) return setLimit((l) => l + 200)
    const el = scroller.current
    const before = el?.scrollHeight ?? 0
    stuck.current = false
    setLoading(true)
    await chatActions.loadEarlier(scratchId)
    setLoading(false)
    setLimit((l) => l + 200)
    requestAnimationFrame(() => el && (el.scrollTop += el.scrollHeight - before))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      return startFind()
    }
    if (e.key !== 'Escape' || e.defaultPrevented || !state) return
    if (state.turn.phase !== 'working' && state.turn.phase !== 'waiting') return
    if (document.querySelector('[data-radix-popper-content-wrapper]')) return
    chatActions.interrupt(scratchId)
  }

  if (!state) return <div className="text-muted-foreground grid h-full place-content-center text-[13px]">Loading the conversation…</div>

  const blockedReason = state.process === 'blocked' ? (cliBlocked(caps, 'claude') ?? 'Claude Code is missing or too old for the Chat view.') : null
  if (blockedReason)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p className="text-muted-foreground max-w-sm text-[13px]">{blockedReason}</p>
        <div>
          <button type="button" onClick={onTerminal} className="border-border hover:bg-accent rounded-[9px] border px-3 py-[5px] text-[13px]">
            Open in Terminal
          </button>
        </div>
      </div>
    )

  if (current)
    return <AgentThread key={path.join('>')} scratchId={scratchId} state={state} agents={agents} path={path} agent={current} dir={thread.dir} project={projectName} thread={threadTitle} onTerminal={onTerminal} />

  const crashNotice = items!.slice(-10).some((i) => i.kind === 'notice' && i.source === 'crash')

  return (
    <div className={cn('@container relative flex h-full min-h-0 flex-col', returning.current && 'm-drill-out')} onKeyDown={onKeyDown} data-chat="view">
      {chips && (engineering || factory) && (
        <div data-chat="mode-chips" className="mx-auto flex w-full max-w-[720px] shrink-0 justify-end gap-2 px-5 pt-2">
          <StageChip crewId={crewId ?? null} on={engineering} />
          <FactoryChip scratchId={scratchId} on={factory} />
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {findOpen && <FindBar query={query} onQuery={setFindQuery} position={activeNo + 1} total={matches.length} onStep={stepFind} onClose={closeFind} />}
          <div ref={scroller} onScroll={onScroll} onWheel={leaveGlide} onTouchStart={leaveGlide} onPointerDown={leaveGlide} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" className={cn('h-full overflow-y-auto', strip && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}>
            <div ref={inner} className="mx-auto flex max-w-[720px] flex-col gap-3.5 px-5 pt-7 pb-4">
              {state.mcpFailed.length > 0 && <div className="text-warning text-[13px]">MCP server failed to connect: {state.mcpFailed.join(', ')}</div>}
              {(capped.hidden > 0 || state.hasEarlier) && (
                <button type="button" disabled={loading} onClick={() => void loadEarlier()} className="text-muted-foreground hover:text-foreground self-center text-[13px] underline-offset-2 hover:underline">
                  {loading ? 'Loading…' : 'Load earlier'}
                </button>
              )}
              {capped.items.length === 0 && state.process !== 'starting' && <p className="text-muted-foreground py-10 text-center text-[13px]">Ask Claude to work on this project.</p>}
              <ConversationList
                scratchId={scratchId}
                items={capped.items}
                agents={agents}
                onOpenAgent={(id) => openAgentThread(scratchId, agents, id)}
                onTerminal={onTerminal}
                live={state.turn.phase === 'working' || state.turn.phase === 'waiting'}
                turnStartedAt={state.turn.startedAt}
              />
              {state.process === 'starting' && <div className="text-muted-foreground animate-pulse text-[13px]">Starting Claude Code…</div>}
              {state.process === 'crashed' && !crashNotice && (
                <div className="text-destructive flex items-center gap-3 text-[13px]">
                  Claude Code stopped unexpectedly.
                  <button type="button" onClick={() => void chatActions.restart(scratchId)} className="border-border text-foreground hover:bg-accent rounded-lg border px-2.5 py-0.5 text-xs">
                    Restart
                  </button>
                </div>
              )}
              {state.process === 'stopped' && items!.length > 0 && <div className="text-muted-foreground text-xs">Claude Code is stopped. Sending a message starts it again.</div>}
            </div>
          </div>
          <aside aria-label="Chat navigation" className="pointer-events-none absolute top-3 right-1 bottom-3 z-10 flex flex-col gap-4 [&>*]:pointer-events-auto">
            {strip && <HistoryStrip scroller={scroller} lines={lines} />}
          </aside>
          {!atBottom && (
            <button
              type="button"
              onClick={jump}
              className={cn('border-border bg-popover text-foreground absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] shadow-md hover:bg-accent')}
            >
              <ArrowDown className="size-3.5" aria-hidden /> Jump to latest
            </button>
          )}
        </div>
        {diffOpen && <DiffPanel items={items!} target={diffTarget} onClose={closeDiff} />}
      </div>
      <StatusLine state={state} />
      <TaskList state={state} />
      <Composer scratchId={scratchId} state={state} launchEffort={launchEffort} tileModel={tileModel} onSent={jump} />
    </div>
  )
}
