import { Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLearnStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { STORE_LABEL } from './ui'

export const OPEN_SETTINGS_EVENT = 'foreman:open-settings'

const PILL = 'bg-accent/60 hover:bg-accent inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px]'

// The memory button: grey when learning is off, amber when a store is down, the last run failed or something waits for
// review, otherwise green. Opens the Lessons page in Settings. `pill` sits in the composer's button row, `footer` in the
// sidebar's bottom row; the default is the small one beside the context readout of a terminal tile.
export function LearningBadge({ variant = 'small' }: { variant?: 'small' | 'pill' | 'footer' }) {
  const status = useLearnStatus()
  const s = status.data
  if (!s) return null
  const down = s.stores.filter((x) => x.enabled && !x.up)
  const waiting = s.pendingLessons + s.pendingDrafts
  const problems = [
    ...down.map((d) => `${STORE_LABEL[d.store]} is down`),
    ...(s.lastRun?.error ? ['the last learn run failed'] : []),
    ...(s.lastRun && s.lastRun.skipped.some((k) => s.stores.find((x) => x.store === k.store)?.enabled) ? ['the last run skipped a store'] : []),
  ]
  const tone = !s.enabled ? 'off' : problems.length > 0 ? 'warn' : 'ok'
  const text = !s.enabled
    ? 'Learning is off'
    : [problems.length ? `Learning needs attention: ${problems.join(', ')}` : 'Learning is healthy', waiting ? `${waiting} waiting for review` : ''].filter(Boolean).join('. ')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={variant === 'footer' ? 'icon-sm' : 'sm'}
          className={cn(
            variant === 'small' && 'h-5 gap-0.5 px-1',
            variant === 'pill' && PILL,
            variant === 'footer' && 'relative',
            tone === 'ok' && 'text-emerald-400',
            tone === 'warn' && 'text-amber-400',
            tone === 'off' && 'text-muted-foreground',
          )}
          aria-label={`Learning health: ${text}`}
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: 'lessons' }))}
        >
          <Brain className={variant === 'footer' ? undefined : 'size-3.5'} />
          {variant === 'pill' && <span className="text-muted-foreground">Memory</span>}
          {waiting > 0 &&
            (variant === 'footer' ? (
              <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4">{waiting}</span>
            ) : (
              <span className="text-[11px]">{waiting}</span>
            ))}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
