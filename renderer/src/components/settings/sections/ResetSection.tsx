import { useState } from 'react'
import { decodeIpcError } from '@shared/ipc'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useResetSettings } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { ConfirmDialog, Row } from '../parts'

const LABELS: Record<keyof Settings, string> = {
  currency: 'Currency',
  dailyBudgetUsd: 'Daily budget',
  fiveHourBudgetUsd: '5-hour budget',
  weeklyBudgetUsd: 'Weekly budget',
  claudePlanUsage: 'Claude plan limits',
  defaultModels: 'Default models',
  defaultEfforts: 'Default effort',
  mainCli: 'Main CLI',
  infoBar: 'Info bar',
  contextWarnPct: 'Context warning level',
  contextDangerPct: 'Context danger level',
  engineMaxWorkers: 'Engine worker cap',
  shell: 'Shell',
  ide: 'IDE',
  updates: 'Updates',
  keybinds: 'Shortcuts',
  uiScale: 'UI scale',
  appearance: 'Appearance',
  layout: 'Layout',
  terminal: 'Terminal',
  tiles: 'Tiles',
  mods: 'Mods',
  topBar: 'Top bar',
  confirm: 'Close confirmations',
  notify: 'Notifications',
  dictation: 'Dictation',
  tokens: 'Tokens and cache',
  browser: 'Browser',
  setupDone: 'First-start setup',
}

const SECTIONS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>

export function ResetSection() {
  const reset = useResetSettings()
  const [target, setTarget] = useState<keyof Settings | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doReset = async () => {
    if (!target) return
    setError(null)
    try {
      await reset.mutateAsync(target === 'all' ? undefined : target)
      toast(target === 'all' ? 'All settings are back to their defaults.' : `${LABELS[target]} is back to its defaults.`)
      setTarget(null)
    } catch (e) {
      setError(decodeIpcError(e).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reset settings</CardTitle>
        <CardDescription>
          Put a settings group back to its defaults. Backups (they are files) are not touched.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {SECTIONS.map((k) => (
          <Row key={k} label={LABELS[k]}>
            <Button variant="outline" size="sm" onClick={() => setTarget(k)}>
              Reset
            </Button>
          </Row>
        ))}
        <Row label="All settings" hint="Every group above at once.">
          <Button variant="destructive" size="sm" onClick={() => setTarget('all')}>
            Reset all settings
          </Button>
        </Row>
      </CardContent>
      <ConfirmDialog
        open={target != null}
        title={target === 'all' ? 'Reset all settings?' : `Reset ${target ? LABELS[target] : ''}?`}
        confirmLabel={target === 'all' ? 'Reset all' : 'Reset'}
        busy={reset.isPending}
        error={error}
        onConfirm={() => void doReset()}
        onClose={() => {
          setTarget(null)
          setError(null)
        }}
      >
        <p>{target === 'all' ? 'Every setting returns to its default and your changes are lost.' : 'Your changes to this group are lost.'}</p>
      </ConfirmDialog>
    </Card>
  )
}
