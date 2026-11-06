import { useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMcpServers, useSaveSettings, useSettings } from '@/lib/queries'
import { CommitInput, Row } from '../parts'

const splitNames = (t: string) => [...new Set(t.split(',').map((n) => n.trim()).filter(Boolean))]

// What a Lite session may load: the MCP servers and plugins ticked or named here. Nothing else starts.
export function LiteSection() {
  const settings = useSettings().data
  const save = useSaveSettings()
  const servers = useMcpServers(null)
  const lite = settings?.lite
  // The list as last asked for, so quick ticks build on each other instead of on the saved value that has not come back yet.
  const pending = useRef<string[] | null>(null)
  if (!lite) return <p className="text-muted-foreground text-sm">Loading settings...</p>
  const current = pending.current ?? lite.mcpServers
  // Saved names that no longer show up in the user's config stay listed, so they can be unticked.
  const names = [...new Set([...(servers.data?.servers ?? []).map((s) => s.name), ...lite.mcpServers])].sort((a, b) => a.localeCompare(b))
  const toggle = (name: string, on: boolean) => {
    const next = on ? [...new Set([...current, name])] : current.filter((n) => n !== name)
    pending.current = next
    save.mutate({ lite: { mcpServers: next } }, { onSettled: () => (pending.current = null) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lite sessions</CardTitle>
        <CardDescription>Lite starts with only these. Nothing else loads.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label="MCP servers Lite may use" hint="Tick the servers a Lite thread starts with. The list is your user-level MCP servers." info="A Lite thread starts Claude with only the MCP servers ticked here, so it begins with far fewer tokens. If none are ticked, it starts with no MCP servers at all.">
          <div className="flex max-h-56 w-full max-w-80 flex-col gap-1.5 overflow-y-auto">
            {names.length === 0 && (
              <p className={servers.isError ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
                {servers.isError ? 'Could not load MCP servers' : servers.isLoading ? 'Looking for MCP servers...' : 'No MCP servers found.'}
              </p>
            )}
            {names.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-primary size-4" aria-label={`Lite may use ${name}`} checked={current.includes(name)} onChange={(e) => toggle(name, e.target.checked)} />
                {name}
              </label>
            ))}
            {names.length > 0 && servers.isError && <p className="text-destructive text-sm">Could not refresh MCP servers</p>}
          </div>
        </Row>
        <Row label="Plugins Lite may use" hint="Folder names of Foreman plugins, separated by commas. Empty means none." info="A Lite thread loads only the Foreman mod and pack plugins named here, by their folder name. Empty means none load. Your own installed plugins never load in a Lite thread." htmlFor="lite-plugins">
          <CommitInput id="lite-plugins" value={lite.plugins.join(', ')} className="w-full max-w-80" spellCheck={false} onCommit={(v) => save.mutate({ lite: { plugins: splitNames(v) } })} />
        </Row>
      </CardContent>
    </Card>
  )
}
