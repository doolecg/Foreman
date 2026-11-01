import type { TileLayout, TileStrip } from '@shared/settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useSaveSettings, useSettings } from '@/lib/queries'
import { CommitInput, Row } from '../parts'

// A number field that saves on blur or Enter; the main process clamps it to its range.
function NumberField({ id, value, min, max, onCommit }: { id: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  return (
    <CommitInput
      id={id}
      type="number"
      min={min}
      max={max}
      className="w-28"
      value={String(value)}
      onCommit={(v) => {
        const n = Number(v)
        if (v.trim() !== '' && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, Math.round(n))))
      }}
    />
  )
}

export function TerminalSection() {
  const settings = useSettings()
  const save = useSaveSettings()
  const s = settings.data
  if (!s) return null
  const t = s.terminal
  const set = (patch: Partial<typeof t>) => save.mutate({ terminal: patch })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Terminal</CardTitle>
        <CardDescription>How the terminals behave. Open terminals pick these up straight away.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label="Copy on select" info="When on, text you select in a terminal with the mouse is copied to the clipboard as soon as you release the button, so you do not need Ctrl+C. On by default. It copies only the selection you just made." hint="Selecting text copies it once, when you let go of the mouse." htmlFor="term-copy">
          <Switch id="term-copy" checked={t.copyOnSelect} onCheckedChange={(v) => set({ copyOnSelect: v })} />
        </Row>
        <Row label="Right click pastes" info="Right-clicking in a terminal copies the selection and clears it when text is selected, and pastes the clipboard when nothing is selected, the way Windows Terminal works. Turn it off if you would rather the right click did nothing. On by default." hint="Right click copies a selection, or pastes when nothing is selected." htmlFor="term-rclick">
          <Switch id="term-rclick" checked={t.rightClickPaste} onCheckedChange={(v) => set({ rightClickPaste: v })} />
        </Row>
        <Row label="Soft two-line prompt" info="Gives the plain shell terminals Foreman starts a soft two-line prompt. The first line shows the folder in blue, the git branch in green with a small dot when there are uncommitted changes, and on the right how long the last command took when it ran for 3 seconds or more. The second line is where you type, with a green arrow that turns red when the last command failed. It works in PowerShell, bash and zsh through small files kept in Foreman's own data folder, and it never edits your own shell files. Turn it off to keep your own prompt. It also stays off if you set your own shell under Terminals." hint="Applies to new shell terminals only, not ones that are already open." htmlFor="term-softprompt">
          <Switch id="term-softprompt" checked={t.softPrompt} onCheckedChange={(v) => set({ softPrompt: v })} />
        </Row>
        <Row label="Font size" info="The size of the text inside terminals, in pixels, from 8 to 32. Bigger is easier to read but fits fewer lines and columns. The default is 13. Open terminals change straight away and refit themselves." hint="In px, 8 to 32." htmlFor="term-font">
          <NumberField id="term-font" value={t.fontSize} min={8} max={32} onCommit={(n) => set({ fontSize: n })} />
        </Row>
        <Row label="Scrollback" info="The number of lines each terminal remembers above the visible screen, from 500 to 100000. A higher number lets you scroll back further in long sessions but uses more memory. The default is 5000." hint="Lines kept per terminal, 500 to 100000." htmlFor="term-scroll">
          <NumberField id="term-scroll" value={t.scrollback} min={500} max={100000} onCommit={(n) => set({ scrollback: n })} />
        </Row>
        <Row label="Ctrl+click file paths" info="File paths that appear in terminal output are underlined, and Ctrl+click (Cmd on a Mac) opens the file. It only opens files inside the project folder. Turn it off if you click paths by accident. On by default." hint="Opens a file path in the terminal output." htmlFor="term-links">
          <Switch id="term-links" checked={t.fileLinks} onCheckedChange={(v) => set({ fileLinks: v })} />
        </Row>
        <Row label="Dropped files type their paths" info="When you drag a file from your file manager or the sidebar onto a terminal, its full path is typed in for you, handy for telling Claude which file to look at. Off means dropped files are ignored. On by default." hint="Drop a file on a terminal to type its path." htmlFor="term-drop">
          <Switch id="term-drop" checked={t.dropPaths} onCheckedChange={(v) => set({ dropPaths: v })} />
        </Row>
      </CardContent>
    </Card>
  )
}

export function TilesSection() {
  const settings = useSettings()
  const save = useSaveSettings()
  const s = settings.data
  if (!s) return null
  const t = s.tiles
  const set = (patch: Partial<typeof t>) => save.mutate({ tiles: patch })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tiles</CardTitle>
          <CardDescription>The Terminal view's tiling surface. Changes apply live. Tile shortcuts are under Shortcuts.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Layout" info="Dwindle splits the space in halves, with each new tile taking half of the previous one. Master keeps one large tile on one side with the rest stacked beside it. The tile layout shortcut switches between them. Default is dwindle." hint="Dwindle splits the space in halves; master keeps one large tile beside a stack." htmlFor="tiles-layout">
            <Select value={t.layout} onValueChange={(v) => set({ layout: v as TileLayout })}>
              <SelectTrigger id="tiles-layout" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dwindle">Dwindle</SelectItem>
                <SelectItem value="master">Master</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Gap" info="The gap between tiles in pixels, from 0 to 40. A bigger gap makes tiles easier to tell apart, a smaller one gives each terminal more room. The default is 6, and it changes live." hint="Space between tiles, in px (0 to 40)." htmlFor="tiles-gap">
            <NumberField id="tiles-gap" value={t.gaps} min={0} max={40} onCommit={(n) => set({ gaps: n })} />
          </Row>
          <Row label="Tile header" info="Normal shows the full title bar with the name, subtitle and buttons. Compact makes it shorter and drops the subtitle. Hidden removes the title bar completely, giving the terminal more height. The default is normal." hint="The header strip on each tile." htmlFor="tiles-strip">
            <Select value={t.strip} onValueChange={(v) => set({ strip: v as TileStrip })}>
              <SelectTrigger id="tiles-strip" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="compact">Compact</SelectItem>
                <SelectItem value="hide">Hidden</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

    </>
  )
}
