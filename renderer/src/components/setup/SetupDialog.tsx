import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PROGRAM_IDS, firstStartItems, shouldShowSetup, statusLabel, type InstallId } from '@shared/install'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocateActions } from '@/components/settings/LocateActions'
import { useAppInfo, useInstallRun, useInstallStatus, useSaveSettings, useSettings } from '@/lib/queries'

// Offered once, at the first start: the optional tools. Nothing is ticked, and nothing runs until "Install selected".
export function SetupDialog() {
  const settings = useSettings()
  const status = useInstallStatus()
  const run = useInstallRun()
  const save = useSaveSettings()
  const [picked, setPicked] = useState<Set<InstallId>>(new Set())
  const [running, setRunning] = useState<InstallId | null>(null)
  const [results, setResults] = useState<Partial<Record<InstallId, string>>>({})
  const [finished, setFinished] = useState(false)
  const items = firstStartItems(settings.data?.mainCli, status.data)
  const platform = useAppInfo().data?.platform ?? 'win32'

  const claudeMissing = status.data?.find((x) => x.id === 'claude' && x.state === 'missing')
  const open = shouldShowSetup(settings.data?.setupDone) && status.data !== undefined
  const busy = running !== null
  const finish = () => save.mutate({ setupDone: true }, { onSettled: () => { setFinished(false); setResults({}); setPicked(new Set()) } })

  const installSelected = async () => {
    const ids = items.filter((i) => picked.has(i.id)).map((i) => i.id)
    setResults({})
    for (const id of ids) {
      setRunning(id)
      const r = await run.mutateAsync(id)
      setResults((p) => ({ ...p, [id]: r.ok ? 'Installed' : r.error }))
    }
    setRunning(null)
    setFinished(true)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && finish()}>
      <DialogContent size="sm" data-testid="setup-dialog">
        <DialogHeader>
          <DialogTitle>Set up optional tools</DialogTitle>
          <DialogDescription>
            Foreman works without these. Pick the ones you want and Foreman installs them for you. You can do this later from Settings, Install.
          </DialogDescription>
        </DialogHeader>
        {claudeMissing && (
          <div className="mx-6 space-y-0.5 rounded-md border p-3 text-sm" role="note" aria-label="Claude Code was not found">
            <p className="font-medium">Claude Code was not found</p>
            <p className="text-muted-foreground text-xs">Foreman needs it for Claude chats. Look in its default places, or point Foreman at the program if you installed it somewhere else.</p>
            <LocateActions item={claudeMissing} />
          </div>
        )}
        <ul className="space-y-2 px-6" aria-label="Optional tools">
          {items.map((it) => {
            const s = status.data?.find((x) => x.id === it.id)
            const installed = s?.state === 'installed'
            const result = results[it.id]
            return (
              <li key={it.id} className="space-y-0.5">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary mt-0.5 size-4"
                    aria-label={`Install ${it.name}`}
                    checked={picked.has(it.id)}
                    disabled={busy || finished || installed}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = new Set(p)
                        if (e.target.checked) next.add(it.id)
                        else next.delete(it.id)
                        return next
                      })
                    }
                  />
                  <span>
                    <span className="font-medium">{it.name}</span>
                    <span className="text-muted-foreground block text-xs">{it.enables}</span>
                    <span className="text-muted-foreground block text-xs">{installed ? statusLabel(s) : null}</span>
                  </span>
                </label>
                {s && s.state === 'missing' && PROGRAM_IDS.includes(it.id) && (
                  <div className="pl-6">
                    <LocateActions item={s} />
                  </div>
                )}
                {running === it.id && (
                  <p className="text-muted-foreground flex items-center gap-2 pl-6 text-xs" role="status">
                    <Loader2 className="size-3 animate-spin" /> Installing {it.name}
                  </p>
                )}
                {result && (
                  <p role="status" className={result === 'Installed' ? 'text-muted-foreground pl-6 text-xs' : 'text-destructive pl-6 text-xs'}>
                    {result}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        <div className="text-muted-foreground mx-6 space-y-1 rounded-md bg-muted p-3 text-xs" role="note" aria-label="What Foreman runs">
          <p>Most installs run a package manager command (npm, winget or pip) that installs the tool on this computer, outside Foreman. The dictation model downloads into Foreman itself.</p>
          {platform === 'win32' && (
            <p>
              On Windows Foreman also runs its own bundled PowerShell scripts with <code>-ExecutionPolicy Bypass</code>, for media controls and updates.
              This applies only to those scripts and does not change your execution policy.
            </p>
          )}
          <p>
            These tools have their own licenses and terms. Foreman is provided as is under the MIT License, without warranty and, to the extent permitted by law, without liability for loss
            or damage. Back up your work. See Settings, General, License.
          </p>
        </div>
        <DialogFooter>
          {finished ? (
            <Button onClick={finish}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={finish}>
                Not now
              </Button>
              <Button disabled={busy || picked.size === 0} onClick={() => void installSelected()}>
                {busy && <Loader2 className="animate-spin" />}
                Install selected
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
