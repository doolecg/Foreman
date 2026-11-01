import { BrowserWindow } from 'electron'
import { tilePopoutWindowTitle, type TilePopoutRequest } from '../shared/tile-popout'

export interface TilePopoutOptions {
  getMainWindow: () => BrowserWindow | null
  // Loads the app's renderer in the new window with the request in the query (see shared/tile-popout.ts).
  load: (win: BrowserWindow, req: TilePopoutRequest) => void
  // Same webPreferences as the main window (preload, sandbox, context isolation).
  webPreferences: Electron.WebPreferences
  icon?: string
  // FOREMAN_BACKGROUND=1: windows show without taking focus.
  background: boolean
  // The app window's navigation guard, so the pop-out only ever shows the app.
  isAppUrl: (url: string) => boolean
  // The set of popped-out tiles changed: push it to every window.
  onChange: (scratchIds: number[]) => void
}

// One pop-out window per terminal tile (keyed by scratch id). The window attaches to the same live session as the tile;
// the main window unmounts the tile's body while the window is open, so only one terminal sizes the PTY at a time.
export class TilePopout {
  private readonly wins = new Map<number, BrowserWindow>()

  constructor(private readonly o: TilePopoutOptions) {}

  ids(): number[] {
    return [...this.wins.keys()]
  }

  isOut(scratchId: number): boolean {
    return this.wins.has(scratchId)
  }

  windows(): BrowserWindow[] {
    return [...this.wins.values()].filter((w) => !w.isDestroyed())
  }

  // webContents ids of the pop-outs: ipc.ts must trust these senders and push events to them as well.
  webContentsIds(): number[] {
    return this.windows().map((w) => w.webContents.id)
  }

  open(req: TilePopoutRequest): void {
    const existing = this.wins.get(req.scratchId)
    if (existing && !existing.isDestroyed()) {
      if (!this.o.background) existing.focus()
      return
    }
    const main = this.o.getMainWindow()
    const win = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 420,
      minHeight: 300,
      show: false,
      title: tilePopoutWindowTitle(req.title),
      icon: this.o.icon,
      autoHideMenuBar: true,
      backgroundColor: main && !main.isDestroyed() ? main.getBackgroundColor() : undefined,
      webPreferences: this.o.webPreferences,
    })
    this.wins.set(req.scratchId, win)

    win.once('ready-to-show', () => (this.o.background ? win.showInactive() : win.show()))
    win.webContents.on('will-navigate', (e, url) => {
      if (!this.o.isAppUrl(url)) e.preventDefault()
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => {
      this.wins.delete(req.scratchId)
      this.o.onChange(this.ids())
    })

    this.o.load(win, req)
    this.o.onChange(this.ids())
  }

  // Pop back in (also what closing the window does).
  close(scratchId: number): void {
    const w = this.wins.get(scratchId)
    if (w && !w.isDestroyed()) w.close()
  }

  // The main window closed (or the app is quitting).
  closeAll(): void {
    for (const w of this.windows()) w.close()
  }
}
