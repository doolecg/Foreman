import { useEffect, useRef, useState } from 'react'
import { PanelLeft, Plus, Settings, SquareTerminal, Terminal } from 'lucide-react'
import { ConsoleDrawer } from '@/components/console/ConsoleDrawer'
import { useConsole } from '@/components/console/useConsole'
import { DeleteCrewDialog, EditCrewDialog, NewCrewDialog } from '@/components/dashboard/Dialogs'
import { GitChangesDialog } from '@/components/dashboard/GitChangesDialog'
import { GitDialog } from '@/components/git/GitDialog'
import { projectActions } from '@/components/dashboard/projectActions'
import { useTerminals } from '@/components/terminal/useTerminals'
import { useWaitingTiles } from '@/components/terminal/useWaitingTiles'
import { Toaster } from '@/components/ui/toaster'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { TerminalView } from '@/components/terminal/TerminalView'
import { TerminalDrawer } from '@/components/terminal/TerminalDrawer'
import { TicketBoard } from '@/components/board/TicketBoard'
import { OPEN_SETTINGS_EVENT } from '@/lib/settingsEvent'
import { ServersPopover } from '@/components/dashboard/ServersPopover'
import { ProviderLimitBadge } from '@/components/cost/ProviderBadge'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { iconBtn } from '@/components/topbar/pill'
import { ClockPill } from '@/components/topbar/ClockPill'
import { OPEN_CHANGES_EVENT } from '@/components/chat/ChangedFilesCard'
import { GitChip } from '@/components/topbar/GitChip'
import { MediaBar } from '@/components/topbar/MediaBar'
import { ModeToggles } from '@/components/topbar/ModeToggles'
import { TopNav, type View } from '@/components/topbar/TopNav'
import { ActivityMenu } from '@/components/topbar/ActivityMenu'
import { UsageDialog } from '@/components/cost/UsageDialog'
import { useBarTier } from '@/components/topbar/useBarTier'
import { mediaCommand } from '@/components/topbar/useMedia'
import { matches, matchesMouseEvent, swallowBoundMouse } from '@/lib/keys'
import { effectiveScale, stepScale, useUiScale } from '@/lib/uiScale'
import { useCrews, useLiveUpdates, useMoveToGroup, useSaveSettings, useSettings } from '@/lib/queries'
import { bridge } from '@/lib/bridge'
import { toast } from '@/lib/toast'
import { decodeIpcError } from '@shared/ipc'
import { CloseAppDialog } from '@/components/terminal/CloseAppDialog'
import { SetupDialog } from '@/components/setup/SetupDialog'
import { useCloseTile } from '@/components/terminal/useCloseTile'
import type { Crew } from '@shared/types'
import type { MainCli } from '@shared/settings'

const LAST_CREW = 'foreman.lastCrew'

function readLastCrew(): number | null {
  try {
    const v = localStorage.getItem(LAST_CREW)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function App() {
  useLiveUpdates()
  const crews = useCrews()
  const [crewId, setCrewId] = useState<number | null>(readLastCrew)
  const [newCrew, setNewCrew] = useState(false)
  const [crewDialog, setCrewDialog] = useState<'edit' | 'delete' | null>(null)
  const [page, setPage] = useState<'dashboard' | 'settings'>('dashboard')
  const [view, setView] = useState<View>('thread')
  const [settingsSection, setSettingsSection] = useState<string | undefined>()
  const [consoleOpen, setConsoleOpen] = useState(false)
  const bgConsole = useConsole(consoleOpen)
  // The project a new project is added to (from a group's "+"), the project a delete or changes dialog is about.
  const [newCrewGroup, setNewCrewGroup] = useState<number | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<Crew | null>(null)
  const [changesTarget, setChangesTarget] = useState<Crew | null>(null)
  const moveToGroup = useMoveToGroup()
  const [barRef, tier] = useBarTier()
  const searchRef = useRef<HTMLInputElement>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  // The Welcome screen shows while there is no project, until the Playground has been opened.
  const [playgroundSeen, setPlaygroundSeen] = useState(false)

  // Fall back to the first crew when the remembered one is gone.
  useEffect(() => {
    const list = crews.data
    if (!list) return
    if (crewId == null || !list.some((r) => r.id === crewId)) setCrewId((list.find((r) => r.kind !== 'playground') ?? list[0])?.id ?? null)
  }, [crews.data, crewId])

  // Components ask for a settings page by dispatching this event.
  useEffect(() => {
    const open = (e: Event) => openSettingsAt((e as CustomEvent<string>).detail)
    window.addEventListener(OPEN_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open)
  }, [])

  // "Open diff" on a chat's changed-files card.
  useEffect(() => {
    const open = () => setGitOpen(true)
    window.addEventListener(OPEN_CHANGES_EVENT, open)
    return () => window.removeEventListener(OPEN_CHANGES_EVENT, open)
  }, [])

  useEffect(() => {
    try {
      if (crewId != null) localStorage.setItem(LAST_CREW, String(crewId))
    } catch {
      /* storage unavailable */
    }
  }, [crewId])

  const settings = useSettings()
  const saveSettings = useSaveSettings()
  useUiScale(settings.data?.uiScale)
  const terminals = useTerminals(crews.data, settings.data?.defaultModels.claude ?? 'sonnet', settings.data?.mainCli ?? 'claude', settings.data?.defaultEfforts.claude ?? '')

  const crew = crews.data?.find((c) => c.id === crewId)
  const layout = settings.data?.layout
  const sidebarHidden = layout?.sidebarHidden ?? false
  const notesOpen = layout?.notesOpen ?? false
  const setLayout = (patch: Partial<NonNullable<typeof layout>>) => saveSettings.mutate({ layout: patch })
  const projectScratch = terminals.tabs.filter((t) => t.crewId === crewId)
  // The bottom drawer holds this project's shells; a new shell opens it, and it closes when the last one goes.
  const [shellsOpen, setShellsOpen] = useState(true)
  const shellTabs = projectScratch.filter((t) => t.kind === 'shell')
  const shellActive = shellTabs.some((t) => t.scratchId === terminals.active) ? terminals.active : (shellTabs.at(-1)?.scratchId ?? null)
  const shellCount = terminals.tabs.filter((t) => t.kind === 'shell').length
  const lastShellCount = useRef(0)
  useEffect(() => {
    if (shellCount > lastShellCount.current) setShellsOpen(true)
    lastShellCount.current = shellCount
  }, [shellCount])
  const waitingTiles = useWaitingTiles()
  const waitingCrews = new Set(terminals.tabs.filter((t) => waitingTiles.has(t.scratchId)).map((t) => t.crewId))
  const closeTile = useCloseTile(terminals.tabs, settings.data?.confirm.closeTile ?? true, terminals.closeTab)
  // A Windows notification was clicked: show that Claude tile.
  useEffect(
    () =>
      bridge().on('notify:open', ({ scratchId, crewId: target }) => {
        setCrewId(target)
        setPage('dashboard')
        terminals.setActive(scratchId)
      }),
    [],
  )
  const tb = settings.data?.topBar

  const openSettingsAt = (section?: string) => (setSettingsSection(section), setPage('settings'))
  const projectMenu = {
    newCli: (c: Crew, cli: MainCli) => void terminals.openTab(c, cli),
    newShell: (c: Crew) => void terminals.openTab(c, 'shell'),
    openIde: (c: Crew) => void projectActions.openIde(c),
    openFolder: (c: Crew) => void projectActions.openFolder(c),
    edit: (c: Crew) => (setCrewId(c.id), setCrewDialog('edit')),
    changes: (c: Crew) => setChangesTarget(c),
    copyPath: (c: Crew) => void projectActions.copyPath(c),
    defaults: () => openSettingsAt('projects'),
    remove: (c: Crew) => setDeleteTarget(c),
    openPlayground: () => {
      const pg = crews.data?.find((c) => c.kind === 'playground')
      if (!pg) return
      setCrewId(pg.id)
      setPlaygroundSeen(true)
      setPage('dashboard')
    },
  }

  // Rebindable shortcuts from Settings; dialogs and the key recorder take keys first.
  useEffect(() => {
    const binds = settings.data?.keybinds
    const uiScale = settings.data?.uiScale ?? 0
    if (!binds) return
    const dash = () => setPage('dashboard')
    const actions: Array<[string, () => void]> = [
        [binds.newCrew, () => (dash(), setNewCrew(true))],
        [binds.openSettings, () => setPage((v) => (v === 'settings' ? 'dashboard' : 'settings'))],
        [binds.toggleConsole, () => setConsoleOpen((v) => !v)],
        [binds.newShell, () => crew && (dash(), void terminals.openTab(crew, 'shell'))],
        [binds.newThread, () => crew && (dash(), setView('thread'), void terminals.openTab(crew, 'agent'))],
        [binds.searchThreads, () => (setLayout({ sidebarHidden: false }), setTimeout(() => searchRef.current?.focus(), 0))],
        [binds.toggleSidebar, () => setLayout({ sidebarHidden: !sidebarHidden })],
        [binds.toggleAllPanels, () => setLayout({ sidebarHidden: !sidebarHidden })],
        [binds.toggleNotes, () => setLayout({ notesOpen: !notesOpen })],
        [binds.openInIde, () => crew && void projectActions.openIde(crew)],
        [binds.openPlayground, () => projectMenu.openPlayground()],
        [binds.mediaPlayPause, () => mediaCommand('toggle')],
        [binds.mediaNext, () => mediaCommand('next')],
        [binds.mediaPrev, () => mediaCommand('prev')],
        [binds.mediaShuffle, () => mediaCommand('shuffle')],
        [binds.zoomIn, () => saveSettings.mutate({ uiScale: stepScale(effectiveScale(uiScale), 1) })],
        [binds.zoomOut, () => saveSettings.mutate({ uiScale: stepScale(effectiveScale(uiScale), -1) })],
        [binds.zoomReset, () => saveSettings.mutate({ uiScale: 0 })],
    ]
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const hit = actions.find(([accel]) => matches(e, accel))
      if (!hit) return
      e.preventDefault()
      hit[1]()
    }
    const onMouse = (e: MouseEvent) => {
      const hit = actions.find(([accel]) => matchesMouseEvent(e, accel))
      if (!hit) return
      e.preventDefault()
      hit[1]()
    }
    const unswallow = swallowBoundMouse(Object.values(binds))
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
      unswallow()
    }
  }, [settings.data?.keybinds, settings.data?.uiScale, saveSettings, crewId, crew, terminals.openTab, crews.data, sidebarHidden, notesOpen])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
      <header ref={barRef} className="bg-sidebar grid h-11 shrink-0 grid-cols-[minmax(auto,1fr)_auto_minmax(auto,1fr)] items-center gap-3 px-3 text-xs">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className={iconBtn} aria-label={sidebarHidden ? 'Show project list' : 'Hide project list'} aria-pressed={!sidebarHidden} onClick={() => setLayout({ sidebarHidden: !sidebarHidden })}>
                <PanelLeft />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">{sidebarHidden ? 'Show project list' : 'Hide project list'} (Alt+B)</TooltipContent>
          </Tooltip>
          <div className="flex shrink-0 items-center gap-2">
            <span aria-hidden className="text-[20px] leading-none text-[#d97757]">
              ◈
            </span>
            {tier < 3 && <span className="text-[14px] font-semibold whitespace-nowrap">Foreman</span>}
          </div>
        </div>
        <TopNav views={['thread', 'board']} view={page === 'dashboard' ? view : null} onChange={(v) => (setView(v), setPage('dashboard'))} />
        <div className="flex items-center justify-end gap-2">
          {crew && <ModeToggles crew={crew} tier={tier} />}
          {tb && tier < 6 && <ClockPill format={tb.clockFormat} seconds={tb.clockSeconds} date={tb.clockDate && tier < 2} />}
          {tb?.mediaControls && tier < 5 && <MediaBar enabled size={tb.mediaSize} tier={tier} />}
          <ActivityMenu crewId={crewId} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className={iconBtn} aria-label="Settings" onClick={() => openSettingsAt()}>
                <Settings />
              </button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {!sidebarHidden && (
          <Sidebar
            crews={crews.data ?? []}
            selected={page === 'dashboard' ? crewId : null}
            onSelect={(id) => (setCrewId(id), setPage('dashboard'), crews.data?.find((c) => c.id === id)?.kind === 'playground' && setPlaygroundSeen(true))}
            onNewCrew={(groupId) => (setNewCrewGroup(groupId), setNewCrew(true))}
            actions={projectMenu}
            waiting={waitingCrews}
            tabs={terminals.tabs}
            active={terminals.active}
            searchRef={searchRef}
            onOpenThread={(row) => (setView('thread'), setPage('dashboard'), void terminals.reopenTab(row))}
            onDeleteThread={(row) => void bridge().invoke('scratch:delete', row.id).then(() => terminals.dropTab(row.id)).catch((e) => toast(decodeIpcError(e).message, true))}
            onArchiveThread={(row) => terminals.closeTab(row.id)}
            onNewThread={() => crew && (setView('thread'), setPage('dashboard'), void terminals.openTab(crew, 'agent'))}
            onNewLiteThread={() => crew && (setView('thread'), setPage('dashboard'), void terminals.openTab(crew, 'claude', true))}
            footer={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Settings" aria-pressed={page === 'settings'} onClick={() => openSettingsAt()}>
                      <Settings />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Settings (Ctrl+,)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="relative"
                      aria-label={bgConsole.errors > 0 ? `Console, ${bgConsole.errors} new errors` : 'Console'}
                      aria-pressed={consoleOpen}
                      onClick={() => setConsoleOpen((v) => !v)}
                    >
                      <Terminal />
                      {bgConsole.errors > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">
                          {bgConsole.errors > 99 ? '99+' : bgConsole.errors}
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Console (Ctrl+J)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Shells"
                      aria-pressed={shellsOpen && shellTabs.length > 0}
                      onClick={() => (shellTabs.length === 0 ? crew && void terminals.openTab(crew, 'shell') : setShellsOpen((v) => !v))}
                    >
                      <SquareTerminal />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Shells for this project</TooltipContent>
                </Tooltip>
                <ServersPopover onOpened={(id) => (setCrewId(id), setPage('dashboard'))} />
                <ProviderLimitBadge onOpen={() => (setPage('dashboard'), setUsageOpen(true))} />
                <GitChip crewId={crewId} compact onOpen={() => setGitOpen(true)} />
              </>
            }
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {page === 'settings' ? (
            <div className="surface min-h-0 flex-1 m-1.5 overflow-hidden"><SettingsPage initialSection={settingsSection} onClose={() => setPage('dashboard')} /></div>
          ) : crews.data && !playgroundSeen && crews.data.every((c) => c.kind === 'playground') ? (
            <div className="surface min-h-0 flex-1 m-1.5 overflow-hidden"><Welcome onNewCrew={() => setNewCrew(true)} /></div>
          ) : (
            <div className="min-h-0 flex-1">
              {view === 'board' ? (
                <TicketBoard key={crewId ?? 'none'} crewId={crewId} onOpenThread={(row) => (setView('thread'), setPage('dashboard'), terminals.reopenTab(row))} />
              ) : (
                crewId != null && (
                <TerminalView
                  crewId={crewId}
                  scratch={projectScratch}
                  active={terminals.active}
                  onCloseScratch={closeTile.request}
                  onStart={(kind) => crew && void terminals.openTab(crew, kind)}
                  mode="thread"
                />
                )
              )}
            </div>
          )}
          {page === 'dashboard' && shellsOpen && shellTabs.length > 0 && (
            <TerminalDrawer
              tabs={shellTabs}
              active={shellActive}
              onSelect={terminals.setActive}
              onClose={closeTile.request}
              onNewShell={() => crew && void terminals.openTab(crew, 'shell')}
              onHide={() => setShellsOpen(false)}
            />
          )}
          {consoleOpen && (
            <ConsoleDrawer
              lines={bgConsole.lines}
              processes={bgConsole.processes}
              onClear={bgConsole.clear}
              onStop={bgConsole.stop}
              onClose={() => setConsoleOpen(false)}
            />
          )}
        </main>
      </div>
      </div>

      <NewCrewDialog
        open={newCrew}
        onOpenChange={(o) => (setNewCrew(o), !o && setNewCrewGroup(undefined))}
        onCreated={(id) => {
          setCrewId(id)
          setPage('dashboard')
          if (newCrewGroup != null) moveToGroup.mutate([id, newCrewGroup])
        }}
      />
      {crew && crewDialog === 'edit' && <EditCrewDialog crew={crew} open onOpenChange={(o) => !o && setCrewDialog(null)} />}
      {crew && crewDialog === 'delete' && (
        <DeleteCrewDialog
          crewId={crew.id}
          crewName={crew.name}
          open
          onOpenChange={(o) => !o && setCrewDialog(null)}
          onDeleted={() => terminals.dropCrew(crew.id)}
        />
      )}
      {deleteTarget && (
        <DeleteCrewDialog
          crewId={deleteTarget.id}
          crewName={deleteTarget.name}
          open
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onDeleted={() => terminals.dropCrew(deleteTarget.id)}
        />
      )}
      {changesTarget && (
        <GitChangesDialog
          crew={changesTarget}
          onClose={() => setChangesTarget(null)}
          onOpenPage={(c) => (setCrewId(c.id), setPage('dashboard'), setGitOpen(true))}
        />
      )}
      {crewId != null && <UsageDialog crewId={crewId} open={usageOpen} onOpenChange={setUsageOpen} />}
      {crewId != null && <GitDialog crewId={crewId} open={gitOpen} onOpenChange={setGitOpen} />}
      {closeTile.dialog}
      <CloseAppDialog />
      <SetupDialog />
      <Toaster />
    </TooltipProvider>
  )
}

function Welcome({ onNewCrew }: { onNewCrew: () => void }) {
  return (
    <div className="grid h-full place-items-center p-10">
      <div className="max-w-md space-y-4 text-center">
        <div aria-hidden className="text-[#d97757] text-5xl leading-none">
          ◈
        </div>
        <h1 className="text-2xl font-semibold">Welcome to Foreman</h1>
        <p className="text-muted-foreground text-sm">
          Add a project folder, open shells and coding agents in it, and keep its usage and git changes in one place.
        </p>
        <Button onClick={onNewCrew}>
          <Plus /> Add your first project
        </Button>
      </div>
    </div>
  )
}
