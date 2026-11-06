import { memo, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, Bot, Box, BrainCircuit, Camera, ChevronRight, Copy, FileText, Gauge, Globe, Info, ListChecks, Minimize2, Network, Pencil, Plug, Search, Sparkles, Square, SquareTerminal, Webhook, Wrench, type LucideIcon } from 'lucide-react'
import {
  partialTarget,
  type CommandItem,
  type DiffFile,
  type NoticeItem,
  type SubagentItem,
  type TextItem,
  type ThinkingItem,
  type ToolItem,
  type TurnItem,
  type UserItem,
} from '@shared/claude-chat'
import { agentTimer, elapsedText, isAgentOpen } from '@shared/chat-summary'
import { Markdown, CopyTextButton } from '@/components/ui/markdown'
import { PixelBar, meterTone } from '@/components/ui/pixel-bar'
import { Critter } from '@/components/mods/agents/Critter'
import { critterFor } from '@/components/mods/agents/agentView'
import { cn } from '@/lib/utils'
import { previewText } from '@/lib/previewText'
import { agentRowFor, agentTitle, agentTldr, formatDuration, isToolRunning, kTokens, noticeChipIcon, toolIconKey, tokensSuffix, toolRowParts, type AgentDot, type ChipIcon, type ToolIconKey } from './chatHelpers'
import { useClock } from './clock'
import { ImageChip } from './ImageChip'
import { ImageModal } from './ImageModal'
import { RewindDialog } from './RewindDialog'
import { useChatWaiting } from './useChat'

const TOOL_ICONS: Record<ToolIconKey, LucideIcon> = {
  memory: BrainCircuit,
  code: Network,
  web: Globe,
  file: FileText,
  edit: Pencil,
  terminal: SquareTerminal,
  search: Search,
  skill: Sparkles,
  agent: Bot,
  todo: ListChecks,
  plug: Plug,
  tool: Wrench,
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn('border-input border-t-foreground size-3 shrink-0 animate-spin rounded-full border-[1.5px] motion-reduce:animate-none', className)} />
}

// ---------------------------------------------------------------- code and diffs

const MAX_DIFF_LINES = 300

export function DiffBlock({ diff }: { diff: DiffFile }) {
  const [all, setAll] = useState(false)
  const rows: Array<{ ln: number | null; sign: string; text: string; hunk: boolean }> = []
  for (const h of diff.hunks) {
    let o = h.oldStart
    let n = h.newStart
    if (rows.length) rows.push({ ln: null, sign: ' ', text: '⋯', hunk: true })
    for (const l of h.lines) {
      const sign = l[0] ?? ' '
      const text = l.slice(1)
      if (sign === '+') rows.push({ ln: n++, sign, text, hunk: false })
      else if (sign === '-') rows.push({ ln: o++, sign, text, hunk: false })
      else {
        rows.push({ ln: n, sign: ' ', text, hunk: false })
        o++
        n++
      }
    }
  }
  const shown = all ? rows : rows.slice(0, MAX_DIFF_LINES)
  return (
    <div className="bg-code overflow-hidden rounded-[10px] py-1.5 font-mono text-[12.5px] leading-[1.65]" data-chat="diff">
      <div className="overflow-x-auto">
        <div className="w-max min-w-full">
          {shown.map((r, i) => (
            <div key={i} className={cn('flex whitespace-pre', r.sign === '+' && 'bg-success/10', r.sign === '-' && 'bg-destructive/10', r.hunk && 'text-muted-foreground/70')}>
              <span className="text-muted-foreground/70 w-10 shrink-0 pr-3 text-right select-none">{r.ln ?? ''}</span>
              <span className={cn('w-4 shrink-0 select-none', r.sign === '+' && 'text-success', r.sign === '-' && 'text-destructive')}>{r.hunk ? '' : r.sign}</span>
              <span className="pr-3">{r.text || ' '}</span>
            </div>
          ))}
        </div>
      </div>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mx-2 min-h-6 rounded-md px-1 pt-1 text-xs focus-visible:ring-2 focus-visible:outline-none">
          Show all {rows.length} lines
        </button>
      )}
    </div>
  )
}

function Pre({ text, className }: { text: string; className?: string }) {
  return (
    <pre tabIndex={0} className={cn('bg-code max-h-80 overflow-auto rounded-[10px] px-3.5 py-3 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap break-words', className)}>
      {text}
    </pre>
  )
}

// Long text folded to a few lines with a Show more / Show less toggle. Display only; the full text is what gets copied.
function PreviewPre({ text, maxLines, className }: { text: string; maxLines: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const p = useMemo(() => previewText(text, maxLines), [text, maxLines])
  const foldable = p.hidden > 0 || p.clipped
  if (!foldable) return <Pre text={text} className={className} />
  return (
    <div>
      {open ? (
        <Pre text={text} className={cn('max-h-80', className)} />
      ) : (
        <pre className={cn('bg-code overflow-hidden rounded-[10px] px-3.5 py-3 font-mono text-[12.5px] leading-[1.65] whitespace-pre', className)}>
          {p.lines.map((l, i) => (
            <div key={i} className="truncate">
              {l || ' '}
            </div>
          ))}
        </pre>
      )}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 min-h-6 rounded-md px-1 text-xs focus-visible:ring-2 focus-visible:outline-none">
        {open ? 'Show less' : p.hidden > 0 ? `Show more (${p.hidden} more ${p.hidden === 1 ? 'line' : 'lines'})` : 'Show more'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- messages

// `editFrom`: the tile's id, which offers "Edit from here" on this message (not for sub-agent prompts or the small Agents view).
export const UserBubble = memo(function UserBubble({ item, small, editFrom }: { item: UserItem; small?: boolean; editFrom?: number }) {
  const [shown, setShown] = useState<number | null>(null)
  const [rewinding, setRewinding] = useState(false)
  const waiting = useChatWaiting(editFrom ?? null)
  const canEdit = editFrom !== undefined && !item.queued && !waiting
  const many = item.images.length > 1
  return (
    <div className="group/user flex min-w-0 flex-col items-end gap-1" style={{ maxWidth: small ? '92%' : '76%' }}>
      <div className={cn('bg-bubble rounded-[18px] px-[15px] py-[9px] leading-[1.55] [overflow-wrap:anywhere] whitespace-pre-wrap', small ? 'text-[13px]' : 'text-[15px]')}>
        {item.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {item.images.map((im, i) => (
              <ImageChip key={i} src={im.dataUrl} name={many ? `Image ${i + 1}` : 'Image'} onOpen={() => setShown(i)} />
            ))}
          </div>
        )}
        <ImageModal image={shown === null ? null : (item.images[shown] ?? null)} at={item.at} index={shown ?? 0} onClose={() => setShown(null)} />
        {item.text}
      </div>
      <div className="text-muted-foreground flex h-4 items-center gap-2 text-xs">
        {item.queued ? <span>Queued</span> : item.seen && <span>Seen</span>}
        <CopyTextButton text={item.text} label="Copy" ariaLabel="Copy message" className="opacity-0 group-focus-within/user:opacity-100 group-hover/user:opacity-100" />
        {canEdit && (
          <button
            type="button"
            aria-label="Edit from here"
            title="Edit from here"
            onClick={() => setRewinding(true)}
            className="m-press hover:bg-accent hover:text-foreground rounded-md p-1 opacity-0 group-focus-within/user:opacity-100 group-hover/user:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
        )}
        {rewinding && <RewindDialog scratchId={editFrom!} itemId={item.id} onClose={() => setRewinding(false)} />}
      </div>
    </div>
  )
})

export const AssistantText = memo(function AssistantText({ item, small }: { item: TextItem; small?: boolean }) {
  return (
    <div className={cn('group/msg bg-card border-border relative max-w-[72ch] rounded-[18px] border', small ? 'px-3 py-2.5' : 'px-[18px] py-3.5')} data-chat="text">
      <Markdown variant="chat" source={item.md} className={small ? 'text-[13px] leading-[1.65]' : undefined} />
      {item.streaming && <span aria-hidden className="bg-foreground/70 ml-0.5 inline-block h-[15px] w-[7px] translate-y-[3px] rounded-[1px] motion-safe:animate-pulse" />}
      {!item.streaming && item.md.length > 0 && (
        <button
          type="button"
          aria-label="Copy reply"
          title="Copy reply"
          onClick={() => void navigator.clipboard?.writeText(item.md).catch(() => {})}
          className="text-muted-foreground hover:text-foreground mt-1 block opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100"
        >
          <Copy className="size-3" />
        </button>
      )}
    </div>
  )
})

// ---------------------------------------------------------------- quiet rows

const rowBtn = 'm-press text-muted-foreground hover:text-foreground hover:bg-accent -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-[3px] text-left text-[13px]'

export const ThinkingRow = memo(function ThinkingRow({ item }: { item: ThinkingItem }) {
  const [open, setOpen] = useState(false)
  const done = item.endedAt !== null
  const label = (done ? `Thought for ${formatDuration(item.endedAt! - item.startedAt)}` : 'Thinking…') + tokensSuffix(item.tokens, true)
  const canOpen = item.text.trim().length > 0
  return (
    <div>
      <button
        type="button"
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        title={item.tokens ? `About ${item.tokens} thinking tokens (Claude Code's estimate)` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(rowBtn, !canOpen && 'cursor-default hover:bg-transparent hover:text-muted-foreground')}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className={cn(!done && 'm-breathe')}>{label}</span>
        {!done && <Spinner />}
      </button>
      {open && canOpen && <div className="text-muted-foreground ml-5 text-[13px] whitespace-pre-wrap">{item.text}</div>}
    </div>
  )
})

function ToolDetails({ t }: { t: ToolItem }) {
  const [shownImage, setShownImage] = useState<number | null>(null)
  const resultImages = t.result?.images ?? []
  const input = t.input && typeof t.input === 'object' ? (t.input as Record<string, unknown>) : {}
  const command = typeof input.command === 'string' ? input.command : null
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const text = t.result?.text ?? ''
  return (
    <div className="mt-1 mb-1 ml-5 space-y-1.5">
      {t.blockedByHook && <p className="text-destructive text-[13px]">Blocked by a hook: {t.blockedByHook}</p>}
      {description && !t.diff && command && <p className="text-foreground text-[13px] [overflow-wrap:anywhere]">{description}</p>}
      {t.diff ? <DiffBlock diff={t.diff} /> : command ? <PreviewPre text={command} maxLines={3} /> : null}
      {!t.diff && text && (
        <div className="group/res relative">
          <PreviewPre text={text} maxLines={12} className={t.result?.isError ? 'text-destructive' : undefined} />
          <CopyTextButton text={text} ariaLabel="Copy result" className="text-muted-foreground absolute top-1.5 right-2 opacity-0 group-focus-within/res:opacity-100 group-hover/res:opacity-100" />
        </div>
      )}
      {resultImages.map((src, i) => (
        <button
          key={i}
          type="button"
          aria-label={resultImages.length > 1 ? `Open image ${i + 1}` : 'Open image'}
          title="Open image"
          onClick={() => setShownImage(i)}
          className="focus-visible:ring-ring block rounded-[10px] focus-visible:ring-2 focus-visible:outline-none"
        >
          <img src={src} alt="Tool result" className="max-h-60 rounded-[10px]" />
        </button>
      ))}
      <ImageModal
        image={shownImage === null || !resultImages[shownImage] ? null : { mediaType: /^data:([^;,]+)/.exec(resultImages[shownImage])?.[1] ?? 'image/png', dataUrl: resultImages[shownImage] }}
        at={t.startedAt}
        index={shownImage ?? 0}
        onClose={() => setShownImage(null)}
      />
      {!t.diff && !text && !command && !isToolRunning(t) && !t.blockedByHook && <p className="text-muted-foreground text-xs">No output</p>}
    </div>
  )
}

export const ToolRow = memo(function ToolRow({ t, small }: { t: ToolItem; small?: boolean }) {
  const [open, setOpen] = useState(t.status === 'failed')
  const p = toolRowParts(t)
  const running = isToolRunning(t)
  const target = p.target || (t.status === 'preparing' ? partialTarget(t.name, t.partial) : '')
  const state = running ? 'running' : t.status
  const Icon = TOOL_ICONS[toolIconKey(t.name)]
  return (
    <div data-chat="tool">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Tool: ${p.verb} ${target}, ${state}`}
        title={target !== t.summary && t.summary ? t.summary : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(rowBtn, small && 'text-xs')}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className={cn('min-w-0 truncate', running && 'm-breathe')}>
          {p.tone === 'denied' && <span className="text-foreground">Denied: </span>}
          <span className={cn('text-foreground font-medium', p.tone === 'failed' && 'text-destructive')}>{p.verb}</span>
          {target && <span className="text-muted-foreground/80"> {target}</span>}
        </span>
        {p.stat && (
          <span className="shrink-0 text-xs">
            <span className="text-success">{p.stat.split(' ')[0]}</span> <span className="text-destructive">{p.stat.split(' ')[1]}</span>
          </span>
        )}
      </button>
      {open && <ToolDetails t={t} />}
    </div>
  )
})

export const ToolGroupRow = memo(function ToolGroupRow({ summary, items, small }: { summary: string; items: ToolItem[]; small?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-chat="tool-group">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(rowBtn, small && 'text-xs')}>
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="text-foreground">{summary}</span>
      </button>
      {open && (
        <div className="ml-5">
          {items.map((t) => (
            <ToolRow key={t.id} t={t} small={small} />
          ))}
        </div>
      )}
    </div>
  )
})

const AGENT_DOT: Record<AgentDot, string> = { running: 'bg-info', waiting: 'bg-warning', done: 'bg-success', failed: 'bg-destructive', unknown: 'bg-muted-foreground' }
const AGENT_WORD: Record<AgentDot, string> = { running: 'Running', waiting: 'Waiting', done: 'Finished', failed: 'Failed', unknown: 'Stopped' }

// An agent: its icon with a status dot, bold name, quiet status word, one line (what it does now, or how it ended), its timer and a chevron.
export const SubagentRow = memo(function SubagentRow({ item, onOpen, small }: { item: SubagentItem; onOpen: (id: string) => void; small?: boolean }) {
  const open = isAgentOpen(item)
  const now = useClock(open)
  const row = agentRowFor(item)
  const critter = critterFor(item.id)
  const ms = agentTimer(item, now)
  const line = (open ? item.latest.trim() : item.status === 'interrupted' ? '' : agentTldr(item)) || row.description
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      title="Open this agent in the Agents panel"
      className={cn('m-press m-enter m-enter-row hover:bg-accent flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left', small && 'text-xs')}
      data-chat="agent"
    >
      <span className="relative shrink-0">
        <Critter hat={critter.hat} tint={critter.tint} bob={open} size={28} />
        <i aria-hidden className={cn('absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full', AGENT_DOT[row.dot], open && 'm-pulse')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('text-foreground min-w-0 truncate text-[13px] font-semibold', row.dot === 'failed' && 'text-destructive')}>{agentTitle(row)}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{AGENT_WORD[row.dot]}</span>
        </span>
        <span className="text-muted-foreground block truncate text-xs">{line}</span>
      </span>
      {ms !== null && <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{elapsedText(ms)}</span>}
      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
    </button>
  )
})

// Above two or more agents of a turn: "2 running, 1 finished".
export function AgentsSummary({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className={cn('text-muted-foreground m-enter m-enter-row px-2 text-[13px]', small && 'text-xs')} data-chat="agents-summary">
      {text}
    </div>
  )
}

// A finished turn's thinking and tool rows in one row: "Worked for 4m 23s" (or "You stopped after 12s"); a click shows them.
export function TurnFold({ ms, stopped, failed, small, children }: { ms: number; stopped: boolean; failed: number; small?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-chat="turn-fold">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(rowBtn, 'w-fit max-w-full', small && 'text-xs')}>
        <span className="min-w-0 truncate">
          {stopped ? 'You stopped after' : 'Worked for'} {elapsedText(ms)}
        </span>
        {failed > 0 && <span className="text-destructive shrink-0">{failed} failed</span>}
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && <div className="m-enter m-enter-row mt-0.5 ml-5 flex flex-col gap-1">{children}</div>}
    </div>
  )
}

// The running turn's heading: "Working for 4m 23s", ticking once a second.
export function WorkingHeading({ startedAt, small }: { startedAt: number; small?: boolean }) {
  const now = useClock(true)
  return (
    <div className={cn('text-muted-foreground py-[3px] text-[13px] tabular-nums', small && 'text-xs')} data-chat="working">
      Working for {elapsedText(now - startedAt)}
    </div>
  )
}

// A pixel meter of how much of the model's context window the agent uses.
export function ContextBar({ ctx }: { ctx: { pct: number; used: number; window: number } }) {
  return (
    <PixelBar
      className="mt-1 mb-0.5"
      fraction={Math.min(100, ctx.pct) / 100}
      tone={meterTone(ctx.pct, 75, 90)}
      label={`Context ${Math.round(ctx.pct)}% used`}
      title={`${kTokens(ctx.used)} of ${kTokens(ctx.window)} tokens`}
    />
  )
}

export const CommandRow = memo(function CommandRow({ item }: { item: CommandItem }) {
  return (
    <div className="text-muted-foreground" data-chat="command">
      <div className="text-[13px]">
        <span className="text-foreground">/{item.command}</span>
      </div>
      {item.md.trim() && <Markdown variant="chat" source={item.md} className="text-muted-foreground mt-1 text-[13px] leading-[1.6]" />}
    </div>
  )
})

const CHIP_ICONS: Record<ChipIcon, LucideIcon> = { cube: Box, hook: Webhook, gauge: Gauge, compact: Minimize2, stop: Square, alert: AlertCircle, plug: Plug, info: Info, camera: Camera }

const chipBase = 'inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 text-[12.5px] leading-snug'

// A keep-warm ping turn: icon, "ping", the prompt, then the reply behind an arrow.
function PingChip({ item }: { item: NoticeItem }) {
  const p = item.ping!
  const detail = p.running ? 'Keep-warm ping' : `Keep-warm ping: read ${kTokens(p.cacheRead)} tokens from the cache${p.usd !== null ? `, about $${p.usd.toFixed(2)}` : ''}`
  return (
    <div data-chat="ping" className="flex">
      <span className={cn(chipBase, 'bg-muted/60 text-muted-foreground rounded-full')} title={detail}>
        <Box className="size-3.5 shrink-0" aria-hidden />
        <span>ping</span>
        <span className="text-foreground/80 min-w-0 truncate">{item.text}</span>
        <span aria-hidden>↳</span>
        <span aria-hidden className="text-primary">
          ✳
        </span>
        {p.running ? <Spinner /> : p.ok ? <span className="text-success font-bold">{p.reply || 'done'}</span> : <span className="text-warning font-bold">failed</span>}
      </span>
    </div>
  )
}

export const NoticeRow = memo(function NoticeRow({ item, onRestart, onTerminal }: { item: NoticeItem; onRestart: () => void; onTerminal: () => void }) {
  const [open, setOpen] = useState(false)
  const [shownImage, setShownImage] = useState<number | null>(null)
  if (item.ping) return <PingChip item={item} />
  const Icon = CHIP_ICONS[noticeChipIcon(item.source, item.tone)]
  const tone = item.tone === 'error' ? 'bg-destructive/10 text-destructive' : item.tone === 'warn' ? 'bg-warning/10 text-warning' : 'bg-muted/60 text-muted-foreground'
  return (
    <div className="text-[13px]" data-chat="notice" data-source={item.source}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn(chipBase, 'rounded-xl', tone)}>
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="break-words">{item.text}</span>
        </span>
        {item.detail && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2">
            {open ? 'Hide details' : 'Details'}
          </button>
        )}
        {item.actions?.includes('restart') && (
          <button type="button" onClick={onRestart} className="border-border text-foreground hover:bg-accent rounded-lg border px-2.5 py-0.5 text-xs">
            Restart
          </button>
        )}
        {item.actions?.includes('terminal') && (
          <button type="button" onClick={onTerminal} className="border-border text-foreground hover:bg-accent rounded-lg border px-2.5 py-0.5 text-xs">
            Open in Terminal
          </button>
        )}
      </div>
      {open && item.detail && <Pre text={item.detail} className="text-muted-foreground mt-1.5 max-h-48" />}
      {item.images && item.images.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.images.map((im, i) => (
            <button
              key={i}
              type="button"
              aria-label={item.images && item.images.length > 1 ? `Open image ${i + 1}` : 'Open image'}
              title="Open image"
              onClick={() => setShownImage(i)}
              className="focus-visible:ring-ring block rounded-[10px] focus-visible:ring-2 focus-visible:outline-none"
            >
              <img src={im.dataUrl} alt="" className="max-h-60 rounded-[10px]" />
            </button>
          ))}
        </div>
      )}
      <ImageModal image={shownImage === null ? null : (item.images?.[shownImage] ?? null)} at={item.at} index={shownImage ?? 0} onClose={() => setShownImage(null)} />
    </div>
  )
})

export const TurnRow = memo(function TurnRow({ item }: { item: TurnItem }) {
  return (
    <div className="text-muted-foreground/70 text-xs" title={item.outputTokens ? `${item.outputTokens} output tokens this turn` : undefined}>
      {item.ok ? 'Done' : 'Stopped'} in {formatDuration(item.durationMs)}
      {tokensSuffix(item.outputTokens)}
    </div>
  )
})
