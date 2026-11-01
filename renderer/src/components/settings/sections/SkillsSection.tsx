import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { decodeIpcError } from '@shared/ipc'
import { commandText, toolMissing } from '@shared/install'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { call, useAppInfo, useEngineeringStatus, useInstallRun, useInstallStatus, useResetEngineering } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '../parts'
import { ToolRow } from './ToolRow'

// The skills Foreman uses, where each lives, and how to install or reset them: the Superpowers pack and the Engineering and
// Factory skills (which are built in and copied to the data folder).
export function SkillsSection() {
  const status = useInstallStatus()
  const platform = useAppInfo().data?.platform ?? 'win32'
  const run = useInstallRun()
  const pack = useEngineeringStatus().data
  const reset = useResetEngineering()
  const [confirm, setConfirm] = useState<'install' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sp = status.data?.find((x) => x.id === 'superpowers')
  const noClaude = toolMissing(status.data, 'claude')

  const install = async () => {
    setConfirm(null)
    setError(null)
    const r = await run.mutateAsync('superpowers')
    if (!r.ok) setError(r.error)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skill packs</CardTitle>
          <CardDescription>The skills that Foreman's presets and modes use, and where each one lives.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <ToolRow
            testId="skills-superpowers"
            name="Superpowers skills pack"
            badge={<Badge variant={sp?.state === 'installed' ? 'secondary' : 'outline'}>{sp?.state === 'installed' ? (sp.version ? `Installed ${sp.version}` : 'Installed') : status.isPending ? 'Checking' : 'Not installed'}</Badge>}
            tag="optional"
            description="The Superpowers skills that presets can use."
            detail={sp?.path ? `Location: ${sp.path}` : noClaude ? 'Needs Claude Code first.' : undefined}
            error={error}
            install={
              <Button size="sm" variant="outline" disabled={run.isPending || sp?.state === 'installed' || noClaude} aria-label="Install Superpowers" onClick={() => setConfirm('install')}>
                {run.isPending && <Loader2 className="animate-spin" />}
                {run.isPending ? 'Installing' : 'Install'}
              </Button>
            }
          />
          <ToolRow
            testId="skills-engineering"
            name="Engineering and Factory skills"
            badge={<Badge variant="secondary">{pack?.edited.length ? `${pack.edited.length} edited` : 'Built in'}</Badge>}
            tag="required"
            description="The skills the two modes use. Your copy lives in the Foreman data folder; edit it freely. Reset puts the built-in version back and keeps a backup of your edits."
            detail={pack?.folder ? `Location: ${pack.folder}` : undefined}
            install={
              <Button size="sm" variant="outline" aria-label="Open the skills folder" onClick={() => call('engineering:openFolder').catch((e) => toast(decodeIpcError(e).message, true))}>
                Open folder
              </Button>
            }
            add={
              <Button size="sm" variant="outline" aria-label="Reset the skills to built-in" onClick={() => setConfirm('reset')}>
                Reset
              </Button>
            }
          />
        </CardContent>
      </Card>
      <ConfirmDialog open={confirm === 'install'} title="Install Superpowers?" confirmLabel="Run the install" onClose={() => setConfirm(null)} onConfirm={() => void install()}>
        <p>Foreman will run this command for you:</p>
        <p className="bg-muted rounded-md px-2 py-1.5 font-mono text-xs break-all">{commandText('superpowers', platform)}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'reset'}
        title="Reset the Engineering and Factory skills?"
        confirmLabel="Reset"
        busy={reset.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          reset.mutate([], {
            onSuccess: () => (setConfirm(null), toast('Skills reset.')),
            onError: (e) => (setConfirm(null), toast(decodeIpcError(e).message, true)),
          })
        }
      >
        <p>{pack?.edited.length ? `${pack.edited.length} edited ${pack.edited.length === 1 ? 'file' : 'files'} will be backed up first.` : 'No files are edited. The built-in version is put back.'}</p>
      </ConfirmDialog>
    </>
  )
}
