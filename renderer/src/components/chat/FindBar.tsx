import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

interface Props {
  query: string
  onQuery: (q: string) => void
  // 1-based place of the active match; 0 when there is none.
  position: number
  total: number
  onStep: (dir: 1 | -1) => void
  onClose: () => void
}

const iconBtn = 'text-muted-foreground hover:text-foreground hover:bg-accent rounded-md p-1 disabled:opacity-40 disabled:hover:bg-transparent'

// The small find bar over the top of the chat. It takes focus when it opens and handles only its own keys.
export function FindBar({ query, onQuery, position, total, onStep, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onStep(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      // Esc closes the bar only; it must not also interrupt a running turn.
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }
  return (
    <div role="search" data-chat="find" className="border-border bg-popover absolute top-2 right-4 z-20 flex items-center gap-1 rounded-lg border px-2 py-1 text-[13px] shadow-md">
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in thread"
        aria-label="Find in thread"
        spellCheck={false}
        className="placeholder:text-muted-foreground w-44 bg-transparent outline-none"
      />
      <span className="text-muted-foreground min-w-14 text-right text-xs tabular-nums" aria-live="polite">
        {query.trim() ? (total ? `${position} of ${total}` : 'No results') : ''}
      </span>
      <button type="button" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={total === 0} onClick={() => onStep(-1)} className={iconBtn}>
        <ChevronUp className="size-3.5" />
      </button>
      <button type="button" aria-label="Next match" title="Next (Enter)" disabled={total === 0} onClick={() => onStep(1)} className={iconBtn}>
        <ChevronDown className="size-3.5" />
      </button>
      <button type="button" aria-label="Close find" title="Close (Esc)" onClick={onClose} className={iconBtn}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}
