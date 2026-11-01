import { useMemo } from 'react'
import type { ChatState, SubagentItem } from '@shared/claude-chat'
import { runningSubagentCount } from '@shared/mods'
import { PixelBar, meterTone, type PixelBarTone } from '@/components/ui/pixel-bar'
import { useProviders, useSettings } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { kTokens } from './chatHelpers'

const FIVE_HOUR = /5[\s-]?h|five|hour|session/i
const WEEK = /week|7[\s-]?day/i
const TEXT: Record<PixelBarTone, string> = { primary: 'text-primary', success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' }

// The 5-hour and 7-day plan usage in percent: the provider poll Foreman already runs (the sidebar badge shares it), else
// the rate-limit event of this chat (a fraction, only reported once it is high).
function usePlanUsage(state: ChatState): { fiveHour: number | null; sevenDay: number | null } {
  const providers = useProviders().data?.providers
  return useMemo(() => {
    const wins = (providers ?? []).filter((p) => p.id === 'claude' || /^claude/i.test(p.name)).flatMap((p) => p.windows.filter((w) => w.usedPct != null))
    let fiveHour = wins.find((w) => FIVE_HOUR.test(w.label))?.usedPct ?? null
    let sevenDay = (wins.find((w) => WEEK.test(w.label) && !w.label.includes('(')) ?? wins.find((w) => WEEK.test(w.label)))?.usedPct ?? null
    const rl = state.rateLimit
    if (rl) {
      const pct = rl.utilization <= 1 ? rl.utilization * 100 : rl.utilization
      if (fiveHour === null && rl.type === 'five_hour') fiveHour = pct
      if (sevenDay === null && rl.type === 'seven_day') sevenDay = pct
    }
    return { fiveHour, sevenDay }
  }, [providers, state.rateLimit])
}

function Figure({ name, pct }: { name: string; pct: number }) {
  const value = Math.round(pct)
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${name} usage ${value}%`}>
      <span className="text-muted-foreground">{name}</span>
      <span aria-hidden className={TEXT[meterTone(value)]}>
        {value}%
      </span>
    </span>
  )
}

// One compact row at the right of the composer's button row, after Enhance prompt: the context window as a pixel meter with its percent, the 5-hour
// plan usage when known, and how many sub-agents are running. The token counts and the 7-day usage are in its tooltip. Model and effort live in the composer.
export function InfoRow({ state }: { state: ChatState }) {
  const settings = useSettings().data
  const usage = usePlanUsage(state)
  const agents = useMemo(() => runningSubagentCount(state.items.filter((i): i is SubagentItem => i.kind === 'subagent')), [state.items])
  const pct = state.contextUsage?.percentage ?? state.context?.percentage ?? null
  const used = state.contextUsage?.totalTokens ?? state.context?.usedTokens ?? null
  const max = state.contextUsage?.maxTokens ?? state.context?.windowTokens ?? null
  const value = pct === null ? null : Math.round(pct)
  const detail = [used !== null && max !== null ? `Context ${kTokens(used)} of ${kTokens(max)} tokens` : null, usage.sevenDay !== null ? `7 days ${Math.round(usage.sevenDay)}%` : null].filter(Boolean).join(' · ')
  const tone = value === null ? 'muted' : meterTone(value, settings?.contextWarnPct ?? 60, settings?.contextDangerPct ?? 85)
  return (
    <div role="group" aria-label="Session info" title={detail || undefined} data-chat="info-row" className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">context</span>
        <PixelBar width={72} fraction={(value ?? 0) / 100} tone={tone} label={value === null ? 'Context window, not reported yet' : `Context window ${value}% full`} />
        <span className={TEXT[tone]}>{value === null ? '—' : `${value}%`}</span>
      </span>
      {usage.fiveHour !== null && <Figure name="5h" pct={usage.fiveHour} />}
      <span className={cn(agents > 0 ? 'text-foreground' : 'text-muted-foreground')}>
        {agents} agent{agents === 1 ? '' : 's'}
      </span>
    </div>
  )
}
