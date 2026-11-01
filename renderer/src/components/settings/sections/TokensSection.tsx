import { RotateCcw } from 'lucide-react'
import type { CacheTtl } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useResetSettings, useSaveSettings, useSettings } from '@/lib/queries'
import { useMoney } from '@/lib/useMoney'
import { NumberField, Row } from '../parts'

function TtlSelect({ id, value, onChange, autoLabel }: { id: string; value: CacheTtl; onChange: (v: CacheTtl) => void; autoLabel: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CacheTtl)}>
      <SelectTrigger id={id} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{autoLabel}</SelectItem>
        <SelectItem value="5m">5 minutes</SelectItem>
        <SelectItem value="1h">1 hour</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function TokensSection() {
  const settings = useSettings()
  const save = useSaveSettings()
  const { symbol, toField, fromField } = useMoney()
  const reset = useResetSettings()
  const s = settings.data
  if (!s) return null
  const t = s.tokens
  const set = (patch: Partial<typeof t>) => save.mutate({ tokens: patch })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spending limits</CardTitle>
          <CardDescription>
            Spend is estimated from session transcripts at list prices. A cap only warns; nothing is stopped.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label={`Daily budget (${symbol})`} hint="All projects and scratch terminals together. 0 turns it off." info="A spending guide for each day, across all projects and scratch terminals. When spend since midnight nears it, Foreman raises a warning. Nothing is stopped. Spend is estimated from session records at list prices. 0 turns it off, which is the default." htmlFor="budget">
            <NumberField
              id="budget"
              min={0}
              max={10000000}
              step="0.5"
              value={toField(s.dailyBudgetUsd)}
              onCommit={(v) => save.mutate({ dailyBudgetUsd: fromField(v) })}
            />
          </Row>
          <Row label={`5-hour budget (${symbol})`} hint="The last 5 hours, all projects together. 0 turns it off." info="A spending guide for any rolling 5-hour period, across all projects. This suits plans that limit use in 5-hour windows. It only warns and never stops anything. Spend is an estimate at list prices. 0 turns it off, which is the default." htmlFor="budget-5h">
            <NumberField id="budget-5h" min={0} max={10000000} step="0.5" value={toField(s.fiveHourBudgetUsd)} onCommit={(v) => save.mutate({ fiveHourBudgetUsd: fromField(v) })} />
          </Row>
          <Row label={`Weekly budget (${symbol})`} hint="The last 7 days, all projects together. 0 turns it off." info="A spending guide for the last 7 days, across all projects. It only warns and never stops anything. Spend is an estimate from session records at list prices, so your real bill may differ. 0 turns it off, which is the default." htmlFor="budget-week">
            <NumberField id="budget-week" min={0} max={10000000} step="0.5" value={toField(s.weeklyBudgetUsd)} onCommit={(v) => save.mutate({ weeklyBudgetUsd: fromField(v) })} />
          </Row>
          <Row label="Warn at (% of a cap)" hint="Raises an activity event and an amber badge." info="The share of a spending limit you must reach before Foreman shows an amber badge and logs an activity event. With a daily limit of 10 and this at 80, the warning appears at 8. Use 1 to 100. The default is 80." htmlFor="warn-pct">
            <NumberField id="warn-pct" min={1} max={100} value={t.capWarnPct} onCommit={(v) => set({ capWarnPct: v })} />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waste signals</CardTitle>
          <CardDescription>These only change what is reported, not what is spent.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row
            label="Cold turn threshold (%)"
            hint="A turn is cold when cache writes exceed this share of its context: the cache was rebuilt and the turn cost full price."
            info="Claude saves repeated context in a cache so it costs less. A turn is flagged cold when more than this share of its context had to be written to the cache again, so it cost full price. This only changes reports, not spending. Use 1 to 100. The default is 50." htmlFor="cold-pct"
          >
            <NumberField id="cold-pct" min={1} max={100} value={t.coldThresholdPct} onCommit={(v) => set({ coldThresholdPct: v })} />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cache and versions</CardTitle>
          <CardDescription>
            A cached prefix is read at a fraction of the normal price, but it expires. Applies to operators started or restarted from now on.
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => reset.mutate('tokens')}>
              <RotateCcw /> Reset section
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="divide-y">
          <Row
            label="Default cache lifetime"
            hint="For operators whose preset says auto. Auto leaves Claude Code's own default alone. 1 hour costs more to write but survives long idle gaps."
            info="How long Claude Code keeps your conversation's repeated context cached at the cheaper rate. 1 hour costs more to write but survives long pauses. 5 minutes is cheaper to write. Auto leaves Claude Code's own default. Applies to tiles started after the change." htmlFor="default-ttl"
          >
            <TtlSelect id="default-ttl" value={t.defaultCacheTtl} onChange={(v) => set({ defaultCacheTtl: v })} autoLabel="Auto (Claude Code default)" />
          </Row>
          <Row
            label="Sub-agent cache lifetime"
            hint="Sub-agents are short-lived, so 5 minutes avoids paying for a 1-hour write they won't reuse."
            info="The cache lifetime for sub-agents, the short-lived helpers Claude starts. They finish quickly, so 5 minutes avoids paying more for a 1-hour cache they never reuse. Auto sets nothing. The default is 5 minutes. Applies to tiles started after the change." htmlFor="sub-ttl"
          >
            <TtlSelect id="sub-ttl" value={t.subagentCacheTtl} onChange={(v) => set({ subagentCacheTtl: v })} autoLabel="Auto (not set)" />
          </Row>
          <Row
            label="Pin the Claude Code version for operators"
            hint="Stops Claude Code updating itself in an operator's terminal: an upgrade changes the prefix and rebuilds every cache. Update it yourself between runs."
            info="A Claude Code upgrade changes what is cached and forces every cache to be rebuilt at full price. When on, Foreman tells Claude Code in its tiles not to update itself, so you update it between runs. On by default." htmlFor="pin-version"
          >
            <Switch id="pin-version" checked={t.pinClaudeVersion} onCheckedChange={(v) => set({ pinClaudeVersion: v })} />
          </Row>
        </CardContent>
      </Card>
    </>
  )
}
