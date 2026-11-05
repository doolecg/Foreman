import { BrowserWindow } from 'electron'

export interface GraphPopoutOptions {
  getMainWindow: () => BrowserWindow | null
  // Loads the app's renderer in the new window with ?graphPopout=<crewId> (see shared/graph-popout.ts).
  load: (win: BrowserWindow, crewId: number) => void
  title: (crewId: number) => string
  // Same webPreferences as the main window (preload, sandbox, context isolation).
  webPreferences: Electron.WebPreferences
  icon?: string
  // FOREMAN_BACKGROUND=1: windows show without taking focus.
  background: boolean
  // The app window's navigation guard, so the pop-out only ever shows the app.
  isAppUrl: (url: string) => boolean
  // The set of popped-out graphs changed: push it to every window.
  onChange: (crewIds: number[]) => void
}

// One pop-out window per project's Orchestration graph. The window shows the same state the panel does (the graph is
// pushed over IPC to every window), so nothing moves between windows; the panel only swaps its graph for a notice.
export class GraphPopout {
  private readonly wins = new Map<number, BrowserWindow>()

  constructor(private readonly o: GraphPopoutOptions) {}

  ids(): number[] {
    return [...this.wins.keys()]
  }

  windows(): BrowserWindow[] {
    return [...this.wins.values()].filter((w) => !w.isDestroyed())
  }

  // webContents ids of the pop-outs: ipc.ts must trust these senders and push events to them as well.
  webContentsIds(): number[] {
    return this.windows().map((w) => w.webContents.id)
  }

  open(crewId: number): void {
    const existing = this.wins.get(crewId)
    if (existing && !existing.isDestroyed()) {
      if (!this.o.background) existing.focus()
      return
    }
    const main = this.o.getMainWindow()
    const win = new BrowserWindow({
      width: 760,
      height: 760,
      minWidth: 320,
      minHeight: 300,
      show: false,
      title: this.o.title(crewId),
      icon: this.o.icon,
      autoHideMenuBar: true,
      backgroundColor: main && !main.isDestroyed() ? main.getBackgroundColor() : undefined,
      webPreferences: this.o.webPreferences,
    })
    this.wins.set(crewId, win)

    win.once('ready-to-show', () => (this.o.background ? win.showInactive() : win.show()))
    win.webContents.on('will-navigate', (e, url) => {
      if (!this.o.isAppUrl(url)) e.preventDefault()
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => {
      this.wins.delete(crewId)
      this.o.onChange(this.ids())
    })

    this.o.load(win, crewId)
    this.o.onChange(this.ids())
  }

  // Pop back in (also what closing the window does).
  close(crewId: number): void {
    const w = this.wins.get(crewId)
    if (w && !w.isDestroyed()) w.close()
  }

  // The main window closed (or the app is quitting).
  closeAll(): void {
    for (const w of this.windows()) w.close()
  }
}
