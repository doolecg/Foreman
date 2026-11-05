import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, FileText, GitBranch, Search, X } from 'lucide-react'
import type { ChatItem } from '@shared/claude-chat'
import { compactCount } from '@shared/chat-changes'
import { cn } from '@/lib/utils'
import { OPEN_CHANGES_EVENT, type OpenChangesDetail } from './ChangedFilesCard'
import { filesForScope, viewedCount, viewedLabel, type DiffScope } from './diffModel'
import { DiffBlock } from './ItemViews'

export interface DiffTarget {
  path?: string
  // Changes on every request, so asking for the same file twice scrolls twice.
  nonce: number
}

interface Props {
  items: ChatItem[]
  target: DiffTarget | null
  onClose: () => void
}

const iconBtn = 'text-muted-foreground hover:text-foreground hover:bg-accent rounded-md p-1 disabled:opacity-40 disabled:hover:bg-transparent'
const SCOPES: Array<[DiffScope, string]> = [
  ['turn', 'This turn'],
  ['all', 'All changes'],
]

const name = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 text-xs tabular-nums">
      <span className="text-success">+{compactCount(added)}</span>
      <span className="text-destructive">-{compactCount(removed)}</span>
    </span>
  )
}

// The chat's side panel (an overlay on narrow chats): the files Claude changed with each file's diff, a scope switch,
// "Viewed" ticks that fold a file away, and find in the diffs. All of it comes from the chat items already in memory.
export function DiffPanel({ items, target, onClose }: Props) {
  const root = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<DiffScope>('turn')
  const [viewed, setViewed] = useState<Set<string>>(() => new Set())
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [total, setTotal] = useState(0)
  const reveal = useRef(false)
  const handled = useRef(-1)

  const files = useMemo(() => filesForScope(items, scope), [items, scope])
  const done = viewedCount(files, viewed)
  const at = total ? Math.min(active, total - 1) : 0

  useEffect(() => root.current?.focus(), [])

  const section = (path: string) => body.current?.querySelector<HTMLElement>(`[data-diff-path="${CSS.escape(path)}"]`)
  const goTo = (path: string) => section(path)?.scrollIntoView({ block: 'start', behavior: 'auto' })

  // A request for one file: open it (widening the scope when the file is from an earlier turn), then scroll to it.
  useEffect(() => {
    if (!target?.path || handled.current === target.nonce) return
    if (section(target.path)) {
      handled.current = target.nonce
      goTo(target.path)
    } else if (scope === 'turn') setScope('all')
    else handled.current = target.nonce
  }, [target, files, scope])

  // Paint the hits with the CSS Custom Highlight API (same look as find in thread), then bring the active one into view.
  useEffect(() => {
    const el = body.current
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    if (!el || !registry || typeof Highlight === 'undefined') return
    registry.delete('diff-hit')
    registry.delete('diff-active')
    const q = query.trim() && findOpen ? query : ''
    // Case-insensitive match on the original text, so the indices stay valid (lowercasing can change a string's length).
    const re = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu') : null
    const hits: Range[] = []
    if (q)
      for (const row of el.querySelectorAll<HTMLElement>('[data-chat="diff"] .whitespace-pre > span:last-child')) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const m of (node.nodeValue ?? '').matchAll(re!)) {
            const r = new Range()
            r.setStart(node, m.index)
            r.setEnd(node, m.index + m[0].length)
            hits.push(r)
          }
        }
      }
    setTotal(hits.length)
    if (!hits.length) return
    const current = hits[Math.min(active, hits.length - 1)]!
    registry.set('diff-hit', new Highlight(...hits))
    registry.set('diff-active', new Highlight(current))
    if (reveal.current) {
      reveal.current = false
      current.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [query, findOpen, active, scope, viewed, files])
  useEffect(
    () => () => {
      const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
      registry?.delete('diff-hit')
      registry?.delete('diff-active')
    },
    [],
  )

  const startFind = () => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInput.current?.focus()
      findInput.current?.select()
    })
  }
  const closeFind = () => {
    setFindOpen(false)
    root.current?.focus()
  }
  const step = (dir: 1 | -1) => {
    if (!total) return
    reveal.current = true
    setActive((at + dir + total) % total)
  }
  const toggleViewed = (path: string) =>
    setViewed((cur) => {
      const next = new Set(cur)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      return startFind()
    }
    if (e.key !== 'Escape') return
    // Esc closes the panel only; it must not also interrupt a running turn.
    if (document.querySelector('[data-radix-popper-content-wrapper]')) return
    e.preventDefault()
    e.stopPropagation()
    if (findOpen && document.activeElement === findInput.current) closeFind()
    else onClose()
  }
  const onFindKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  }

  return (
    <aside
      ref={root}
      tabIndex={-1}
      aria-label="Changes"
      data-chat="diff-panel"
      onKeyDown={onKeyDown}
      className="bg-background border-border absolute inset-y-0 right-0 z-30 flex w-full min-w-0 flex-col border-l text-[13px] shadow-lg outline-none @4xl:static @4xl:w-[460px] @4xl:shrink-0 @4xl:shadow-none"
    >
      <div className="border-border flex shrink-0 items-center gap-1.5 border-b px-2.5 py-1.5">
        <span className="text-foreground font-medium">Changes</span>
        <div role="group" aria-label="Scope" className="bg-accent ml-1 flex rounded-full p-0.5">
          {SCOPES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={scope === id}
              onClick={() => setScope(id)}
              className={cn('rounded-full px-2.5 py-px text-xs', scope === id ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {files.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
            {viewedLabel(done, files.length)}
          </span>
        )}
        <button type="button" aria-label="Find in diff" title="Find in diff (Ctrl+F)" onClick={startFind} className={iconBtn}>
          <Search className="size-3.5" />
        </button>
        <button type="button" aria-label="Open the Git page" title="Open the Git page" onClick={() => window.dispatchEvent(new CustomEvent<OpenChangesDetail>(OPEN_CHANGES_EVENT, { detail: {} }))} className={iconBtn}>
          <GitBranch className="size-3.5" />
        </button>
        <button type="button" aria-label="Close changes" title="Close (Esc)" onClick={onClose} className={iconBtn}>
          <X className="size-3.5" />
        </button>
      </div>
      {findOpen && (
        <div role="search" className="border-border flex shrink-0 items-center gap-1 border-b px-2.5 py-1">
          <input
            ref={findInput}
            value={query}
            onChange={(e) => {
              reveal.current = true
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onFindKeyDown}
            placeholder="Find in diff"
            aria-label="Find in diff"
            spellCheck={false}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
          />
          <span className="text-muted-foreground min-w-14 text-right text-xs tabular-nums" aria-live="polite">
            {query.trim() ? (total ? `${at + 1} of ${total}` : 'No results') : ''}
          </span>
          <button type="button" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={total === 0} onClick={() => step(-1)} className={iconBtn}>
            <ChevronUp className="size-3.5" />
          </button>
          <button type="button" aria-label="Next match" title="Next (Enter)" disabled={total === 0} onClick={() => step(1)} className={iconBtn}>
            <ChevronDown className="size-3.5" />
          </button>
          <button type="button" aria-label="Close find" title="Close find (Esc)" onClick={closeFind} className={iconBtn}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {files.length === 0 ? (
        <p className="text-muted-foreground p-6 text-center">{scope === 'turn' ? 'No files changed in this turn yet.' : 'No files changed in this chat yet.'}</p>
      ) : (
        <>
          <ul className="border-border max-h-36 shrink-0 overflow-y-auto border-b p-1" aria-label="Changed files">
            {files.map((f) => (
              <li key={f.path}>
                <button type="button" title={f.path} onClick={() => goTo(f.path)} className="m-press hover:bg-accent flex w-full items-center gap-2 rounded-lg px-2 py-0.5 text-left">
                  <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className={cn('min-w-0 flex-1 truncate', viewed.has(f.path) && 'text-muted-foreground line-through')}>{name(f.path)}</span>
                  <Counts added={f.added} removed={f.removed} />
                </button>
              </li>
            ))}
          </ul>
          <div ref={body} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
            {files.map((f) => (
              <section key={f.path} data-diff-path={f.path} className="scroll-mt-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium" title={f.path}>
                    {f.path}
                  </span>
                  <Counts added={f.added} removed={f.removed} />
                  <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1 text-xs select-none">
                    <input type="checkbox" checked={viewed.has(f.path)} onChange={() => toggleViewed(f.path)} className="accent-primary" />
                    Viewed
                  </label>
                </div>
                {!viewed.has(f.path) && <DiffBlock diff={f} />}
              </section>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
