import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ModsHost } from '@/components/mods/ModsHost'
import { Sparkles, SquareTerminal } from 'lucide-react'
import type { MainCli } from '@shared/settings'
import { decodeIpcError } from '@shared/ipc'
import type { ScratchView } from '@shared/types'
import { isTileOut } from '@shared/tile-popout'
import { Button } from '@/components/ui/button'
import { BrowserSide } from '@/components/browser/BrowserSide'
import { PoppedOutNotice } from '@/components/browser/BrowserPopout'
import { OperatorTerminal } from '@/components/dashboard/OperatorTerminal'
import { ChatView } from '@/components/chat/ChatView'
import { ChatHeaderControls, ChatStateBadge, ViewSwitch } from '@/components/chat/ChatHeader'
import { ContextButton } from '@/components/chat/ContextPopover'
import { CLI_SHORT, cliBlocked } from '@/lib/capabilities'
import { call, useCapabilities, useCrews, useSettings } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { NOTES_DEFAULT, NOTES_MAX, NOTES_MIN, NOTES_RAIL, NotesPanel, NotesRail } from '@/components/notes/NotesPanel'
import { TileIcon } from './TileFrame'
import { ThreadHeader } from './ThreadHeader'
import { FactoryChip } from '@/components/chat/FactoryBox'
import { StageChip } from '@/components/chat/StageBox'
import { TileInfoBar, TileStatus } from './TileInfoBar'
import { TileSurface } from './TileSurface'
import { useTilePopouts } from './useTilePopouts'
import { isScratchTile, useProjectTiles, type ScratchTileInfo, type TileInfo } from './useProjectTiles'
import type { TerminalTab } from './useTerminals'

const TILES_MIN_WIDTH = 480

const HEADING:Record<string, string> = { claude: 'Claude Code', opencode: 'OpenCode', shell: 'Shell' }

interface Props {
  crewId: number
  // The project's terminals; the agent ones open as tiles here (shells show in the bottom drawer).
  scratch: TerminalTab[]
  // The scratch terminal opened last (the drawer's active one); its tile takes the focus when it is in this project.
  active: number | null
  onCloseScratch: (scratchId: number) => void
  onStart: (kind: 'shell' | MainCli) => void
  // 'thread' shows the open tile on its own, without a frame; 'tiles' shows every tile of the project side by side.
  mode: 'thread' | 'tiles'
}

// The project's Terminal view: the tiles (the shell and agent terminals) and the Mods sub-agent panel.
export function TerminalView({ crewId, scratch, active, onCloseScratch, onStart, mode }: Props) {
  const settings = useSettings().data
  const cli = settings?.mainCli ?? 'claude'
  const strip = settings?.tiles.strip ?? 'normal'
  const blocked = cliBlocked(useCapabilities().data, cli)
  const tiles = useProjectTiles(crewId, scratch)
  const scratchTiles = tiles.filter(isScratchTile)
  const out = useTilePopouts()
  const activeTile = scratchTiles.find((t) => t.scratch.scratchId === active)?.id ?? null
  const crew = useCrews().data?.find((c) => c.id === crewId)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // The Claude tile the Subagent Panel follows: the focused one, else the first Claude tile.
  const claudeTile = scratchTiles.find((t) => t.id === focusedId && t.scratch.kind === 'claude') ?? scratchTiles.find((t) => t.scratch.kind === 'claude')
  // The focused tile is the one on screen: its finished turn does not raise a Windows notification.
  const focusedScratchId = scratchTiles.find((t) => t.id === focusedId)?.scratch.scratchId ?? null
  useEffect(() => {
    void call('notify:visible', focusedScratchId).catch(() => undefined)
  }, [focusedScratchId])
  useEffect(
    () => () => {
      void call('notify:visible', null).catch(() => undefined)
    },
    [],
  )

  // The thread on screen: the tile opened last, else the first one.
  const openTile = tiles.find((t) => t.id === activeTile) ?? tiles[0]

  const close = (t: TileInfo) => onCloseScratch(t.scratch.scratchId)

  // Each Claude tile is in the Chat or the Terminal view (a property of the scratch terminal).
  const qc = useQueryClient()
  const claudeIds = scratchTiles
    .filter((t) => t.scratch.kind === 'claude')
    .map((t) => t.scratch.scratchId)
    .join(',')
  const views = useQuery({
    queryKey: ['scratchViews', crewId, claudeIds],
    queryFn: async () => Object.fromEntries((await call('scratch:list', crewId)).map((s) => [s.id, { title: s.title, view: s.view, effort: s.effort, model: s.model, presetId: s.presetId }])),
    enabled: claudeIds !== '',
  }).data
  const viewOf = (t: ScratchTileInfo): ScratchView | undefined => (t.scratch.kind === 'claude' ? views?.[t.scratch.scratchId]?.view : 'terminal')
  const switchView = (t: ScratchTileInfo, view: ScratchView) =>
    call('scratch:setView', t.scratch.scratchId, view)
      .then(() => qc.invalidateQueries({ queryKey: ['scratchViews'] }))
      .catch((e) => toast(decodeIpcError(e).message, true))
  const effortOf = (t: ScratchTileInfo) => {
    const e = views?.[t.scratch.scratchId]?.effort
    return e && e !== 'default' ? e : null
  }

  const body = (tile: TileInfo) => {
    const t = tile
    // The session lives in its own window: no terminal here, so two of them do not fight over the PTY size.
    if (isTileOut(out, t.scratch.scratchId)) return <PoppedOutNotice title={t.title} onPopIn={() => void call('tile:popIn', t.scratch.scratchId).catch(() => undefined)} />
    const view = viewOf(t)
    if (view === undefined) return null
    if (t.scratch.kind === 'claude' && view === 'chat')
      return (
        <div className="relative h-full min-h-0">
          <ChatView scratchId={t.scratch.scratchId} launchEffort={effortOf(t)} tileModel={views?.[t.scratch.scratchId]?.model ?? ''} onTerminal={() => void switchView(t, 'terminal')} projectName={crew?.name} threadTitle={t.title} crewId={crewId} engineering={crew?.engineering ?? false} factory={crew?.factory ?? false} chips={mode === 'tiles'} />
        </div>
      )
    return (
      <div className="relative h-full min-h-0">
        <OperatorTerminal sessionKey={`scratch:${t.scratch.scratchId}`} autoFocus={false} crewId={crewId} cli={t.scratch.kind} />
      </div>
    )
  }

  const chrome = (tile: TileInfo) => {
    const t = tile
    if (t.scratch.kind === 'claude' && viewOf(t) === 'chat')
      return {
        icon: (
          <span aria-hidden className="text-primary grid size-6 shrink-0 place-items-center text-[13px]">
            ◆
          </span>
        ),
        heading: HEADING.claude,
        badge: <ChatStateBadge scratchId={t.scratch.scratchId} />,
        status: <ChatHeaderControls scratchId={t.scratch.scratchId} onView={(v) => void switchView(t, v)} />,
      }
    return {
      icon: <TileIcon kind={t.scratch.kind} compact={strip === 'compact'} />,
      heading: HEADING[t.scratch.kind],
      subtitle: crew?.name,
      status:
        t.scratch.kind === 'claude' && viewOf(t) === 'terminal' ? (
          <>
            <TileStatus tile={t.scratch} />
            <ViewSwitch view="terminal" blockedReason={null} onChange={(v) => void switchView(t, v)} />
          </>
        ) : (
          <TileStatus tile={t.scratch} />
        ),
    }
  }

  const popOut = (tile: TileInfo) => {
    const t = tile
    if (isTileOut(out, t.scratch.scratchId)) return null
    return () =>
      void call('tile:popOut', { scratchId: t.scratch.scratchId, crewId, kind: t.scratch.kind, title: t.title }).catch((e) => toast(decodeIpcError(e).message, true))
  }

  // The Notes panel: when the area is too narrow for the tiles to keep 480px it shrinks to a rail (and floats open on demand).
  const root = useRef<HTMLDivElement>(null)
  const [areaWidth, setAreaWidth] = useState(0)
  const [notesFloating, setNotesFloating] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setAreaWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const notesOpen = settings?.layout.notesOpen ?? false
  const notesWidth = Math.min(NOTES_MAX, Math.max(NOTES_MIN, settings?.layout.notesWidth || NOTES_DEFAULT))
  const notesNarrow = areaWidth > 0 && areaWidth - notesWidth - 12 < TILES_MIN_WIDTH
  useEffect(() => setNotesFloating(false), [crewId, notesOpen])

  return (
    <div ref={root} className="relative flex h-full min-h-0">
      {notesOpen &&
        (notesNarrow ? (
          notesFloating ? (
            <>
              <div aria-hidden style={{ width: NOTES_RAIL + 6 }} className="shrink-0" />
              <NotesPanel crewId={crewId} onCollapse={() => setNotesFloating(false)} />
            </>
          ) : (
            <NotesRail onExpand={() => setNotesFloating(true)} />
          )
        ) : (
          <NotesPanel crewId={crewId} />
        ))}
      <section aria-label="Terminal tiles" className={cn('flex min-w-0 flex-1 flex-col', mode === 'tiles' && 'p-1.5')}>
        {tiles.length === 0 ? (
          <div className="grid flex-1 place-content-center gap-3 p-4 text-center">
            <p className="text-muted-foreground text-sm">No threads open. Start one here.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => onStart(cli)} disabled={!!blocked} title={blocked}>
                <Sparkles /> Start {CLI_SHORT[cli]}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onStart('shell')}>
                <SquareTerminal /> New shell
              </Button>
            </div>
          </div>
        ) : mode === 'thread' && openTile ? (
          <div data-thread={openTile.id} data-tile={openTile.id} className="flex min-h-0 flex-1 flex-col">
            <ThreadHeader
              title={isScratchTile(openTile) ? (views?.[openTile.scratch.scratchId]?.title || openTile.title) : 'Browser'}
              chips={
                <>
                  <StageChip crewId={crewId} on={crew?.engineering ?? false} />
                  <FactoryChip scratchId={isScratchTile(openTile) && openTile.scratch.kind === 'claude' ? openTile.scratch.scratchId : null} on={crew?.factory ?? false} />
                </>
              }
              badge={isScratchTile(openTile) && openTile.scratch.kind === 'claude' && viewOf(openTile) === 'chat' ? <ChatStateBadge scratchId={openTile.scratch.scratchId} /> : isScratchTile(openTile) ? <TileStatus tile={openTile.scratch} /> : null}
              context={isScratchTile(openTile) && openTile.scratch.kind === 'claude' && viewOf(openTile) === 'chat' ? <ContextButton scratchId={openTile.scratch.scratchId} /> : null}
              claude={isScratchTile(openTile) && openTile.scratch.kind === 'claude' && viewOf(openTile) ? { scratchId: openTile.scratch.scratchId, view: viewOf(openTile)!, onView: (v) => void switchView(openTile, v) } : undefined}
              onPopOut={popOut(openTile)}
              onClose={() => close(openTile)}
            />
            <div className="min-h-0 flex-1">{body(openTile)}</div>
          </div>
        ) : (
          <TileSurface
            crewId={crewId}
            tiles={tiles}
            onClose={close}
            popOut={popOut}
            body={body}
            chrome={chrome}
            info={(t) => (!isScratchTile(t) || t.scratch.kind === 'shell' || (t.scratch.kind === 'claude' && viewOf(t) !== 'terminal') ? null : <TileInfoBar tile={t.scratch} crew={crew} />)}
            onFocusChange={setFocusedId}
            focusId={activeTile}
          />
        )}
      </section>

      <BrowserSide crewId={crewId} />

      {claudeTile && (
        <ModsHost key={claudeTile.scratch.scratchId} tileId={claudeTile.scratch.scratchId} crewId={crew?.id ?? null} engineering={crew?.engineering ?? false} chat={views?.[claudeTile.scratch.scratchId]?.view === 'chat'} />
      )}
    </div>
  )
}
