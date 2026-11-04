import { Switch } from '@/components/ui/switch'
import { modEffect, type ModId, type ModRowId } from '@shared/mods'
import { MODS } from '@/components/mods/registry'
import { useCapabilities, useSaveSettings, useSettings } from '@/lib/queries'
import { NumberField, Row } from '../parts'

const LABELS: Record<ModRowId, string> = {
  subagents: 'Agents panel',
  infoBar: 'Info bar',
  keepWarm: 'Keep warm',
  commandMenu: 'Commands menu',
  promptEnhancer: 'Prompt Enhancer',
  ideaShelf: 'Idea Shelf',
  folderTracker: 'Same-Folder Tracker',
  plainEnglish: 'Plain English',
}

// The order of the list. The Design Picker is not here: it is not one of the mods you turn on and off.
const ORDER: ModRowId[] = ['subagents', 'infoBar', 'keepWarm', 'commandMenu', 'promptEnhancer', 'ideaShelf', 'folderTracker', 'plainEnglish']

export function ModsSection() {
  const settings = useSettings()
  const save = useSaveSettings()
  const caps = useCapabilities().data?.claude
  const s = settings.data
  if (!s) return null
  const m = s.mods
  const setMods = (patch: Partial<typeof m>) => save.mutate({ mods: patch })

  return (
    <>
      {s.mainCli === 'opencode' && (
        <p className="text-muted-foreground text-xs" role="note">
          Mods only run in Claude Code tiles. OpenCode tiles do not load them.
        </p>
      )}
      <div className="surface divide-y px-5 py-2">
        {ORDER.map((id) => {
          const title = MODS.find((x) => x.id === id)?.title ?? LABELS[id]
          const plugin = id === 'promptEnhancer' || id === 'ideaShelf' || id === 'folderTracker' || id === 'plainEnglish'
          const unavailable = id === 'subagents' && !!caps && !caps.subagentEvents
          const on = id === 'infoBar' ? s.infoBar : id === 'keepWarm' ? m.keepWarm : id === 'commandMenu' ? m.commandMenu : m.mods[id as ModId]
          const paused = (id === 'subagents' || plugin) && !m.enabled
          const set = (v: boolean) =>
            id === 'infoBar' ? save.mutate({ infoBar: v }) : id === 'keepWarm' ? setMods({ keepWarm: v }) : id === 'commandMenu' ? setMods({ commandMenu: v }) : setMods({ mods: { ...m.mods, [id as ModId]: v } })
          const hint = unavailable ? 'Unavailable: this Claude Code install does not send sub-agent events.' : plugin ? `${modEffect(id)} Applies to new tiles.` : modEffect(id)
          return (
            <div key={id}>
              <Row label={LABELS[id]} hint={hint} htmlFor={id === 'infoBar' ? 'info-bar' : `mod-${id}`}>
                <Switch
                  id={id === 'infoBar' ? 'info-bar' : `mod-${id}`}
                  aria-label={id === 'infoBar' ? 'Show the info bar' : `Enable ${title}`}
                  checked={on}
                  disabled={paused || unavailable}
                  onCheckedChange={set}
                />
              </Row>
              {id === 'infoBar' && s.infoBar && (
                <div className="m-enter m-enter-row ml-4 pb-1">
                  <Row label="Context warning" hint="The context bar turns amber from this percent (1 to 100)." htmlFor="context-warn">
                    <NumberField id="context-warn" value={s.contextWarnPct} min={1} max={100} onCommit={(n) => save.mutate({ contextWarnPct: n })} />
                  </Row>
                  <Row label="Context danger" hint="The context bar turns red from this percent (1 to 100)." htmlFor="context-danger">
                    <NumberField id="context-danger" value={s.contextDangerPct} min={1} max={100} onCommit={(n) => save.mutate({ contextDangerPct: n })} />
                  </Row>
                </div>
              )}
            </div>
          )
        })}
        <Row label="Pause all mods" hint="Turns off the Agents panel and the Claude Code mods at once. The info bar, Keep warm and Commands menu are not affected." htmlFor="mods-enabled">
          <Switch id="mods-enabled" aria-label="Pause all mods" checked={!m.enabled} onCheckedChange={(v) => setMods({ enabled: !v })} />
        </Row>
      </div>
      <p className="text-muted-foreground px-1 text-xs">Foreman's status line replaces your own inside Foreman Claude tiles.</p>
      <p className="text-muted-foreground px-1 text-xs">The Engineering and Orchestration modes are turned on per project with the switches in the top bar. Their skills are in Settings, Tools and installs.</p>
    </>
  )
}
