import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { DEFAULT_SETTINGS, KEY_ACTIONS, type KeyAction } from '@shared/settings'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatAccel } from '@/lib/keys'
import { useSaveSettings, useSettings } from '@/lib/queries'
import { KeyRecorder, Row } from '../parts'

const GROUPS: Array<{ title: string; ids: KeyAction[] }> = [
  { title: 'Projects', ids: ['newCrew', 'openSettings', 'toggleConsole', 'openPlayground'] },
  { title: 'Project actions', ids: ['newShell', 'openInIde'] },
  { title: 'Panels', ids: ['toggleSidebar', 'toggleAllPanels'] },
  { title: 'Tiles', ids: ['tileLayout', 'tileSplit', 'tileFullscreen', 'tileFocusNext', 'tileFocusPrev', 'tileClose'] },
  { title: 'View', ids: ['zoomIn', 'zoomOut', 'zoomReset'] },
  { title: 'Chat', ids: ['dictate'] },
  { title: 'Media (Windows)', ids: ['mediaPlayPause', 'mediaNext', 'mediaPrev', 'mediaShuffle'] },
]

const labelOf = (id: KeyAction) => KEY_ACTIONS.find((a) => a.id === id)?.label ?? id

const SHORTCUT_INFO: Partial<Record<KeyAction, string>> = {
  newCrew: 'Switches to the project dashboard and opens the New project dialog. Works anywhere in the Foreman window.',
  openSettings: 'Opens the Settings page, or takes you back to the dashboard if Settings is already showing. Works from anywhere in the Foreman window.',
  toggleConsole: 'Shows or hides the console, the log of what Foreman is doing in the background. Useful when something seems stuck. Press it again to close it.',
  openPlayground: 'Jumps to the Playground, the scratch project pinned at the top of the project list, and shows its terminal view. Handy for quick experiments outside a real project.',
  newShell: 'Opens a new plain shell terminal in the selected project folder and switches to the dashboard. It does nothing if no project is selected.',
  openInIde: 'Opens the selected project folder in the editor chosen under Projects settings. If the editor cannot be found, you get an error message instead.',
  toggleSidebar: 'Shows or hides the project list on the left, and remembers the choice. Currently it does the same job as the all panels shortcut below.',
  toggleAllPanels: 'Shows or hides the project list, and remembers the choice. Currently it does exactly the same as the project list shortcut above, whichever key you press.',
  newThread: 'Opens a new chat with the main CLI (Claude Code by default) in the selected project and shows it. It does nothing if no project is selected.',
  searchThreads: 'Jumps to the search box above the project list so you can find a thread or project by name. Press it again, or Esc, to leave the box.',
  toggleNotes: 'Shows or hides the Notes panel beside your tiles, and remembers whether it was open. Works anywhere in the Foreman window.',
  tileLayout: 'Switches the tiles between dwindle (each new tile halves the space) and master (one large tile plus a stack). The choice is saved. Works when the terminal tiles are showing.',
  tileSplit: 'Flips the split direction for the focused tile between side by side and stacked, changing how it shares space with its neighbour. It needs a focused tile.',
  tileFullscreen: 'Makes the focused tile fill the whole tile area, or puts it back if it is already full. Other tiles keep running behind it. It needs a focused tile.',
  tileFocusNext: 'Moves focus to the next tile in the current project, wrapping round to the first after the last. Works when the terminal tiles are showing.',
  tileFocusPrev: 'Moves focus to the previous tile in the current project, wrapping round to the last from the first. Works when the terminal tiles are showing.',
  tileClose: 'Closes the focused tile. You are asked to confirm first unless you turned that question off under General. It needs a focused tile.',
  zoomIn: 'Steps the interface up to the next size, from 80% to 200%, and switches the UI scale from Automatic to that fixed size. Works anywhere in the Foreman window.',
  zoomOut: 'Steps the interface down to the next smaller size, down to 80%, and switches the UI scale from Automatic to that fixed size. Works anywhere in the Foreman window.',
  zoomReset: 'Sets the UI scale back to Automatic, which sizes the interface to fit the window. Works anywhere in the Foreman window.',
  mediaPlayPause: 'Plays or pauses whatever Windows is currently playing, such as Spotify or a browser tab. Windows only, and only while Foreman is the focused window. Unset by default.',
  mediaNext: 'Skips to the next track in whatever Windows is playing. Windows only, and only while Foreman is the focused window. Unset by default.',
  mediaPrev: 'Goes back to the previous track in whatever Windows is playing. Windows only, and only while Foreman is the focused window. Unset by default.',
  mediaShuffle: 'Turns shuffle on or off in the player that Windows is playing from, if that player allows it. Windows only, and only while Foreman is focused. Unset by default.',
  dictate: 'Starts or stops speech-to-text in the Chat message box, but only while the cursor is in that box and the speech model is installed. In hold mode, speak while the key is held.',
}

const shortcutInfo = (id: KeyAction, label: string) => SHORTCUT_INFO[id] ?? `Press to record a new key for "${label}".`

interface Moved {
  id: KeyAction
  from: KeyAction
  accel: string
  previous: string
}

export function ShortcutsSection() {
  const settings = useSettings()
  const save = useSaveSettings()
  const [moved, setMoved] = useState<Moved | null>(null)
  const s = settings.data
  if (!s) return null

  // One accelerator per action: taking a key from another action unbinds it there, and says so (with Undo).
  const setKey = (id: KeyAction, accel: string) => {
    const clash = accel ? KEY_ACTIONS.find((a) => a.id !== id && s.keybinds[a.id] === accel) : undefined
    setMoved(clash ? { id, from: clash.id, accel, previous: s.keybinds[id] } : null)
    save.mutate({ keybinds: { [id]: accel, ...(clash ? { [clash.id]: '' } : {}) } })
  }
  const undo = () => {
    if (!moved) return
    save.mutate({ keybinds: { [moved.id]: moved.previous, [moved.from]: moved.accel } })
    setMoved(null)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keyboard shortcuts</CardTitle>
          <CardDescription>
            Click a shortcut, then press the new keys or the middle, back or forward mouse button. Backspace unbinds, Esc cancels. A key can belong to one action only.
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMoved(null)
                save.mutate({ keybinds: DEFAULT_SETTINGS.keybinds })
              }}
            >
              <RotateCcw /> Reset all
            </Button>
          </CardAction>
        </CardHeader>
        {moved && (
          <CardContent>
            <div role="status" className="flex items-center justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span>
                {formatAccel(moved.accel)} was bound to {labelOf(moved.from)}; it is now unbound there.
              </span>
              <Button variant="outline" size="sm" onClick={undo}>
                Undo
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {GROUPS.map((g) => (
        <Card key={g.title}>
          <CardHeader>
            <CardTitle className="text-base">{g.title}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {g.ids.map((id) => (
              <Row key={id} label={labelOf(id)} info={shortcutInfo(id, labelOf(id))}>
                <div className="flex items-center gap-2">
                  <KeyRecorder label={labelOf(id)} value={s.keybinds[id]} onChange={(accel) => setKey(id, accel)} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Reset ${labelOf(id)} shortcut`}
                    title="Back to the default"
                    disabled={s.keybinds[id] === DEFAULT_SETTINGS.keybinds[id]}
                    onClick={() => setKey(id, DEFAULT_SETTINGS.keybinds[id])}
                  >
                    <RotateCcw />
                  </Button>
                </div>
              </Row>
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  )
}
