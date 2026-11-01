import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { installItems, GIT_MCP_ROW_NAME, MCP_RUNTIME_INSTALL, PROGRAM_IDS, canRunInstall, commandText, installItem, statusLabel, type InstallId, type InstallStatusItem } from '@shared/install'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { LocateActions } from '../LocateActions'
import { OptionalMcpPanel, STATUS_LABEL } from './OptionalMcpCard'
import { ToolRow } from './ToolRow'
import { useAppInfo, useInstallRun, useInstallStatus, useOptionalMcp, useSaveSettings, useSettings } from '@/lib/queries'

// "Location: <path>" for a tool that is there, and whether the owner chose it.
const locationText = (s: InstallStatusItem | undefined) => (s?.path ? `Location: ${s.path}${s.custom ? ' (chosen by you)' : ''}` : null)

export function InstallSection() {
  const status = useInstallStatus()
  const settings = useSettings()
  const platform = useAppInfo().data?.platform ?? 'win32'
  const run = useInstallRun()
  const save = useSaveSettings()
  const [confirm, setConfirm] = useState<InstallId | null>(null)
  const [running, setRunning] = useState<InstallId | null>(null)
  const [errors, setErrors] = useState<Partial<Record<InstallId, string>>>({})

  const start = async (id: InstallId) => {
    setConfirm(null)
    setRunning(id)
    setErrors((e) => ({ ...e, [id]: undefined }))
    const r = await run.mutateAsync(id)
    setRunning(null)
    if (!r.ok) setErrors((e) => ({ ...e, [id]: r.error }))
  }
  const mcp = useOptionalMcp(null)
  const mcpOf = (id: 'git' | 'playwright') => mcp.data?.find((m) => m.id === id)
  const gitEntry = mcpOf('git')
  const installButton = (id: InstallId, label: string, installed: boolean): ReactNode =>
    canRunInstall(id, platform) ? (
      <Button size="sm" variant="outline" disabled={running !== null || installed} aria-label={label} onClick={() => setConfirm(id)}>
        {running === id && <Loader2 className="animate-spin" />}
        {running === id ? 'Installing' : 'Install'}
      </Button>
    ) : null
  const item = confirm ? installItem(confirm) : null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Programs and runtimes</CardTitle>
          <CardDescription>
            Nothing here is installed until you click Install and confirm the command. A feature whose tool is missing stays hidden.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {installItems(settings.data?.mainCli, status.data).filter((it) => it.id !== 'superpowers').map((it) => {
            const s = status.data?.find((x) => x.id === it.id)
            const mcpId = it.id === 'playwright' ? it.id : null
            const entry = mcpId ? mcpOf(mcpId) : undefined
            const installBtn = installButton(it.id, `Install ${it.name}`, s?.state === 'installed')
            const locate = s && PROGRAM_IDS.includes(it.id) ? <LocateActions item={s} /> : undefined
            const badge = <Badge variant={s?.state === 'installed' ? 'secondary' : 'outline'}>{status.isPending ? 'Checking' : statusLabel(s)}</Badge>
            if (entry) {
              return (
                <OptionalMcpPanel
                  key={it.id}
                  crewId={null}
                  e={entry}
                  row={{
                    testId: `install-${it.id}`,
                    name: it.name,
                    badge: (
                      <>
                        {badge}
                        <Badge variant={entry.status === 'not-added' ? 'outline' : 'secondary'}>{STATUS_LABEL[entry.status]}</Badge>
                      </>
                    ),
                    description: it.enables,
                    install: installBtn,
                    locate,
                    error: errors[it.id],
                  }}
                />
              )
            }
            const lines = [it.note, it.id === 'claude' ? `Install: ${commandText(it.id, platform)}` : null, locationText(s)].filter(Boolean)
            const detail = lines.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))
            return (
              <ToolRow
                key={it.id}
                testId={`install-${it.id}`}
                name={it.name}
                badge={badge}
                tag={it.optional ? 'optional' : 'required'}
                description={it.enables}
                detail={lines.length ? detail : undefined}
                error={errors[it.id]}
                install={installBtn}
                below={locate}
              />
            )
          })}
          {gitEntry ? (
            <OptionalMcpPanel
              crewId={null}
              e={gitEntry}
              row={{
                testId: 'install-git-mcp',
                name: GIT_MCP_ROW_NAME,
                badge: <Badge variant={gitEntry.status === 'not-added' ? 'outline' : 'secondary'}>{STATUS_LABEL[gitEntry.status]}</Badge>,
                description: gitEntry.description,
                install: gitEntry.runtime.ok ? null : installButton(MCP_RUNTIME_INSTALL.git, `Install ${installItem(MCP_RUNTIME_INSTALL.git).name} for ${gitEntry.name}`, false),
              }}
            />
          ) : (
            <ToolRow
              testId="install-git-mcp"
              name={GIT_MCP_ROW_NAME}
              badge={<Badge variant="outline">{mcp.isPending ? 'Checking' : 'Unknown'}</Badge>}
              tag="optional"
              description="The official Git server: an agent reads the history, status, diffs and branches of a repository."
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">First-start setup</CardTitle>
          <CardDescription>The window that offers the optional installs once, when Foreman first starts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate({ setupDone: false })}>
            Show setup again
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={item !== null}
        title={item ? `Install ${item.name}?` : ''}
        description={
          item ? (
            <>
              <p>Foreman will run this command for you:</p>
              <p className="bg-muted rounded-md px-2 py-1.5 font-mono text-xs break-all">{commandText(item.id, platform)}</p>
            </>
          ) : null
        }
        confirmLabel="Run the install"
        testId="install-confirm"
        onConfirm={() => confirm && void start(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
