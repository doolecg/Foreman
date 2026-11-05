import { useLayoutEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Navigation, Pencil, X } from 'lucide-react'
import type { QueuedMessage } from '@shared/claude-chat'
import { queuePreview } from '@shared/chat-queue'
import { useFlip } from '@/components/ui/use-flip'

interface Props {
  queue: QueuedMessage[]
  // Why "Send now" is unavailable (null: it is available).
  sendBlocked: string | null
  onEdit: (id: string) => void
  onMove: (id: string, by: -1 | 1) => void
  onSend: (id: string) => void
  onRemove: (id: string) => void
  // Shortcut that sends the first queued message now, shown as a hint.
  sendFirstKey: string
}

const btn =
  'text-muted-foreground enabled:hover:bg-background enabled:hover:text-foreground focus-visible:ring-ring/50 inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md outline-none transition-transform duration-[90ms] focus-visible:ring-2 enabled:active:scale-[.96] disabled:opacity-40 motion-reduce:transition-none motion-reduce:enabled:active:scale-100'

// A row slides in from 4px below; with reduced motion it only fades.
function enter(el: HTMLElement | null): void {
  if (!el) return
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.animate(calm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px) scale(.98)' }, { opacity: 1, transform: 'none' }], calm ? { duration: 80 } : { duration: 340, easing: 'cubic-bezier(.32,.72,0,1)' })
}

// The messages held until Claude's turn ends, above the chat box: edit, reorder, send now, remove.
export function QueueStrip({ queue, sendBlocked, onEdit, onMove, onSend, onRemove, sendFirstKey }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  useFlip(list)
  const refocus = useRef<{ id: string; act: 'up' | 'down'; after: string } | null>(null)
  // A moved row is re-inserted, which drops keyboard focus: put it back on the same arrow (or the other at the ends).
  useLayoutEffect(() => {
    const f = refocus.current
    if (!f) return
    refocus.current = null
    // A rejected move leaves the order as it was: do not grab focus for it.
    if (queue.map((m) => m.id).join() !== f.after) return
    const find = (act: string) => box.current?.querySelector<HTMLButtonElement>(`[data-qid="${f.id}"][data-act="${act}"]`)
    const same = find(f.act)
    ;(same && !same.disabled ? same : find(f.act === 'up' ? 'down' : 'up'))?.focus()
  }, [queue])
  const move = (id: string, act: 'up' | 'down') => {
    const ids = queue.map((m) => m.id)
    const from = ids.indexOf(id)
    const to = from + (act === 'up' ? -1 : 1)
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
    refocus.current = { id, act, after: ids.join() }
    onMove(id, act === 'up' ? -1 : 1)
  }
  return (
    <div ref={box} role="region" aria-label="Queued messages" className="surface mx-auto mb-1.5 max-w-[720px] p-1.5">
      <div className="text-muted-foreground px-2 pt-0.5 pb-1 text-[13px]">{queue.length} queued{sendBlocked === null && ` · ${sendFirstKey} sends the first now`}</div>
      <ul ref={list} className="max-h-40 overflow-y-auto">
        {queue.map((m, i) => {
          const n = i + 1
          const label = queuePreview(m.text)
          return (
            <li key={m.id} ref={enter} data-flip={m.id} className="hover:bg-accent flex items-center gap-0.5 rounded-xl py-0.5 pr-1 pl-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
              {m.imageCount > 0 && <span className="text-muted-foreground shrink-0 px-1 text-[12px]">{m.imageCount === 1 ? '1 image' : `${m.imageCount} images`}</span>}
              <button type="button" aria-label={`Edit queued message ${n}`} title="Edit: put it back in the box" onClick={() => onEdit(m.id)} className={`${btn} w-6`}>
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button type="button" data-qid={m.id} data-act="up" aria-label={`Move queued message ${n} up`} title="Move up" disabled={i === 0} onClick={() => move(m.id, 'up')} className={`${btn} w-6`}>
                <ChevronUp className="size-3.5" aria-hidden />
              </button>
              <button type="button" data-qid={m.id} data-act="down" aria-label={`Move queued message ${n} down`} title="Move down" disabled={i === queue.length - 1} onClick={() => move(m.id, 'down')} className={`${btn} w-6`}>
                <ChevronDown className="size-3.5" aria-hidden />
              </button>
              <button type="button" aria-label={`Send queued message ${n} now`} title={sendBlocked ?? `Send now${i === 0 ? ' (Alt+Enter from an empty box)' : ''}`} disabled={sendBlocked !== null} onClick={() => onSend(m.id)} className={`${btn} px-2 text-[13px]`}>
                <Navigation className="size-3.5" aria-hidden /> Send now
              </button>
              <button type="button" aria-label={`Remove queued message ${n}`} title="Remove" onClick={() => onRemove(m.id)} className={`${btn} w-6`}>
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
