import { Download, Loader2, RefreshCw } from 'lucide-react'
import { CURRENCIES, type CurrencyCode } from '@shared/currency'
import { commandText, installItem, statusLabel } from '@shared/install'
import type { UpdateStatus } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { bridge } from '@/lib/bridge'
import { timeAgo } from '@/lib/format'
import { formatAccel } from '@/lib/keys'
import { useAppInfo, useInstallRun, useInstallStatus, useSaveSettings, useSettings, useUpdateStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { NumberField, Row } from '../parts'
import { UiScaleSelect } from '../UiScaleControl'
import { useState } from 'react'

function UpdateRow({ status }: { status?: UpdateStatus }) {
  const [checking, setChecking] = useState(false)
  const check = async (force = false) => {
    setChecking(true)
    try {
      await bridge().invoke('update:check', force)
    } finally {
      setChecking(false)
    }
  }
  const s = status
  const line = !s
    ? '…'
    : {
        idle: 'Not checked yet',
        unsupported: s.message ?? 'Updates are unavailable',
        checking: 'Checking for updates…',
        current: s.message ?? 'Foreman is up to date',
        downloading: `Downloading ${s.version}…`,
        ready: `Version ${s.version} is ready to install`,
        installing: `Installing ${s.version}…`,
        error: s.message ?? 'Update check failed',
      }[s.state]

  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className={cn('text-sm', s?.state === 'error' && 'text-destructive')}>{line}</div>
        {s?.state === 'ready' && s.message && <p className="text-destructive mt-0.5 text-xs">{s.message}</p>}
        <p className="text-muted-foreground mt-0.5 text-xs">
          You have {s?.currentVersion ?? '…'}
          {s?.checkedAt ? ` · checked ${timeAgo(s.checkedAt)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {s?.url && (
          <Button variant="ghost" size="sm" onClick={() => void bridge().invoke('app:openExternal', s.url!)}>
            Release notes
          </Button>
        )}
        {s?.state === 'current' && (
          <Button variant="ghost" size="sm" onClick={() => void check(true)} disabled={checking}>
            Reinstall latest
          </Button>
        )}
        {s?.state === 'ready' ? (
          <Button size="sm" onClick={() => void bridge().invoke('update:install')}>
            <Download /> Restart to update
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void check()}
            disabled={checking || s?.state === 'unsupported' || s?.state === 'checking' || s?.state === 'downloading'}
          >
            {checking || s?.state === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
          </Button>
        )}
      </div>
    </div>
  )
}

function DictationCard() {
  const settings = useSettings()
  const save = useSaveSettings()
  const run = useInstallRun()
  const speech = useInstallStatus().data?.find((x) => x.id === 'dictation')
  const platform = useAppInfo().data?.platform ?? 'win32'
  const [confirm, setConfirm] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const s = settings.data
  if (!s) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dictation</CardTitle>
          <CardDescription>The microphone button in the Chat composer. Speech is turned into text on this device.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Enable dictation" hint="Off hides the microphone button and the dictation shortcut does nothing." info="Shows a microphone button in the Chat composer, and turns on the dictation shortcut, so you can speak instead of typing. The speech is turned into text on this device. When off, the button is hidden and the shortcut does nothing." htmlFor="dictation-enabled">
            <Switch id="dictation-enabled" checked={s.dictation.enabled} onCheckedChange={(v) => save.mutate({ dictation: { enabled: v } })} />
          </Row>
          <Row label="Hold to talk" hint="On: record only while the shortcut is held down, and transcribe when you let go. Off: press once to start and again to stop." info="Off, you press the dictation shortcut once to start recording and again to stop. On, you hold the shortcut down while you talk and the words are written when you let go. Holding suits short bursts. Off is the default." htmlFor="dictation-hold">
            <Switch id="dictation-hold" checked={s.dictation.mode === 'hold'} onCheckedChange={(v) => save.mutate({ dictation: { mode: v ? 'hold' : 'toggle' } })} />
          </Row>
          <Row label="Shortcut" hint="Change it in Shortcuts. A key combination or the middle, back or forward mouse button.">
            <kbd className="bg-muted rounded px-2 py-0.5 font-mono text-xs">{formatAccel(s.keybinds.dictate)}</kbd>
          </Row>
          <Row label="Speech model" hint={installError ?? installItem('dictation').enables}>
            <div className="flex items-center gap-2">
              <Badge variant={speech?.state === 'installed' ? 'secondary' : 'outline'}>{statusLabel(speech)}</Badge>
              <Button size="sm" variant="outline" aria-label="Install Dictation speech model" disabled={installing || speech?.state === 'installed'} onClick={() => setConfirm(true)}>
                {installing && <Loader2 className="animate-spin" />}
                {installing ? 'Installing' : 'Install'}
              </Button>
            </div>
          </Row>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirm}
        title="Install Dictation speech model?"
        description={<p>{commandText('dictation', platform)}</p>}
        confirmLabel="Run the install"
        testId="install-confirm"
        onConfirm={async () => {
          setConfirm(false)
          setInstalling(true)
          setInstallError(null)
          const r = await run.mutateAsync('dictation')
          setInstalling(false)
          if (!r.ok) setInstallError(r.error)
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}

export function GeneralSection() {
  const settings = useSettings()
  const update = useUpdateStatus()
  const save = useSaveSettings()
  const s = settings.data
  if (!s) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Display</CardTitle>
          <CardDescription>Automatic grows the interface with the window, so a maximized screen looks as roomy as a small one. Ctrl+= and Ctrl+- step it, Ctrl+0 returns to automatic.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="UI scale" info="Zooms the whole app between 80% and 200%. Automatic starts from 100% and grows the interface on larger windows, up to 175%, so a maximised big screen is not tiny. A fixed percentage stays put whatever the window size." htmlFor="ui-scale">
            <UiScaleSelect id="ui-scale" className="w-36" />
          </Row>
          <Row label="Currency" info="Changes the currency symbol and amounts on costs, spend and budgets. Foreman works out everything in US dollars underneath, so this only changes how the numbers are shown. Choose from ten currencies; the default is US dollars." hint="Costs, spend and budgets are shown in this currency. Amounts are kept in US dollars; there is no online lookup, so type the rate yourself." htmlFor="currency">
            <Select value={s.currency.code} onValueChange={(v) => save.mutate({ currency: { code: v as CurrencyCode } })}>
              <SelectTrigger id="currency" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} ({c.symbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {s.currency.code !== 'USD' && (
            <Row label="Rate: 1 USD =" info="How many units of your currency one US dollar buys, for example 0.8 for pounds. Every dollar amount is multiplied by this number before it is shown. It is never looked up online, so update it yourself when rates change." hint={`How many ${s.currency.code} one US dollar buys.`} htmlFor="currency-rate">
              <NumberField id="currency-rate" aria-label={`Rate: 1 USD in ${s.currency.code}`} min={0.0001} max={1000000} step="0.0001" value={s.currency.rate} onCommit={(v) => save.mutate({ currency: { rate: v } })} />
            </Row>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Updates</CardTitle>
          <CardDescription>New versions come from GitHub releases and download in the background.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <UpdateRow status={update.data} />
          <Row label="Channel" info="Stable only offers finished releases. Dev also offers pre-release test builds, so you get new features sooner but they may have rough edges. The choice applies from the next update check." hint="Dev also offers the test builds made from the dev branch before they are released." htmlFor="channel">
            <Select value={s.updates.channel} onValueChange={(v) => save.mutate({ updates: { channel: v as 'stable' | 'beta' } })}>
              <SelectTrigger id="channel" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="beta">Dev</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Check for updates" info="How often Foreman asks GitHub whether a newer version exists. It also checks a few seconds after the app starts. A found update downloads in the background. Only at startup turns off the repeat checks. The default is every 3 hours." htmlFor="interval">
            <Select value={String(s.updates.checkHours)} onValueChange={(v) => save.mutate({ updates: { checkHours: Number(v) } })}>
              <SelectTrigger id="interval" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Every hour</SelectItem>
                <SelectItem value="3">Every 3 hours</SelectItem>
                <SelectItem value="6">Every 6 hours</SelectItem>
                <SelectItem value="12">Every 12 hours</SelectItem>
                <SelectItem value="24">Once a day</SelectItem>
                <SelectItem value="0">Only at startup</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Install downloaded updates when Foreman quits" info="When an update has finished downloading and is waiting, closing Foreman installs it automatically. Off means you choose when to install it from the update row above. This is on by default and does not apply to Linux .deb installs." htmlFor="on-quit">
            <Switch
              id="on-quit"
              checked={s.updates.installOnQuit}
              onCheckedChange={(v) => save.mutate({ updates: { installOnQuit: v } })}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Closing</CardTitle>
          <CardDescription>Closing a terminal or Foreman asks first when something would stop. "Don't ask again" in those dialogs turns the question off here.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Ask before closing a terminal" info="Asks you to confirm before a terminal tile is closed, and says whether Claude is still working and will be stopped. Terminals whose process has already ended close without asking. On by default." htmlFor="confirm-tile">
            <Switch id="confirm-tile" checked={s.confirm.closeTile} onCheckedChange={(v) => save.mutate({ confirm: { closeTile: v } })} />
          </Row>
          <Row label="Ask before closing Foreman" info="Asks you to confirm before Foreman quits, but only when Claude, OpenCode or shell terminals are running. It lists what will be stopped. With nothing running, it closes straight away. On by default." htmlFor="confirm-app">
            <Switch id="confirm-app" checked={s.confirm.closeApp} onCheckedChange={(v) => save.mutate({ confirm: { closeApp: v } })} />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>A Windows notification when Claude finishes or waits for you, shown only while you are looking at another window or tile. Clicking it opens that tile.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Notify when Claude finishes" info="Shows a system notification when Claude finishes its turn, with the tile name and the first line of its reply. It only appears when the window is not focused or you are looking at a different tile. Clicking it opens that tile." htmlFor="notify-finished">
            <Switch id="notify-finished" checked={s.notify.finished} onCheckedChange={(v) => save.mutate({ notify: { finished: v } })} />
          </Row>
          <Row label="Notify when Claude needs me" info="Shows a system notification when Claude stops to ask for permission or to ask you a question, so a tile does not sit waiting unnoticed. It only appears when you are not looking at that tile. Clicking it opens the tile." hint="A permission request or a question." htmlFor="notify-needs">
            <Switch id="notify-needs" checked={s.notify.needs} onCheckedChange={(v) => save.mutate({ notify: { needs: v } })} />
          </Row>
        </CardContent>
      </Card>

      <DictationCard />

      <Card data-testid="settings-license">
        <CardHeader>
          <CardTitle className="text-base">License</CardTitle>
          <CardDescription>Foreman is free software under the MIT License. Copyright © 2026 doolecg.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-xs">
          <p>
            Foreman is provided "as is", without warranty of any kind. To the extent permitted by law, the authors are not liable for any claim, damages
            or other liability arising from its use, including anything an AI agent does from a terminal you start in it. Back up your work.
          </p>
          <p>
            Claude Code, OpenCode and the other tools Foreman starts or installs are separate software under their own licenses and terms.
            Foreman is not made by or affiliated with Anthropic or the makers of those tools.
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => void bridge().invoke('app:openLicenses')}>
              Open license files
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void bridge().invoke('app:openExternal', 'https://github.com/doolecg/Foreman/blob/main/LICENSE')}>
              License on GitHub
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
