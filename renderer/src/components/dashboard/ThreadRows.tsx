import { useState } from 'react'
import { Archive, ChevronRight, Trash2 } from 'lucide-react'
import { tileState } from '@shared/claude-chat'
import type { Crew, ScratchTerminal } from '@shared/types'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useChatState } from '@/components/chat/useChat'
import type { TerminalTab } from '@/components/terminal/useTerminals'
import { shortAge } from '@/lib/format'
import { useThreads } from '@/lib/queries'
import { cn } from '@/lib/utils'

const OPENABLE = new Set(['claude', 'opencode'])

// The dot of a thread: coral and pulsing while it works, amber while it waits for the owner, green once it has an answer, grey otherwise.
function Dot({ id, open }: { id: number; open: boolean }) {
  const state = useChatState(open ? id : null)
  const word = state ? tileState(state) : null
  return <i aria-hidden className={cn('size-[7px] shrink-0 rounded-full', word === 'Working' ? 'bg-primary motion-safe:animate-pulse' : word === 'Waiting for you' ? 'bg-warning' : open ? 'bg-success/75' : 'bg-muted-foreground/40')} />
}

// The threads of the open project under its row: the ones open as tiles, newest first, then a "Settled" shelf of closed chats that can be opened again.
export function ThreadRows({ crew, tabs, active, query, onOpen, onDelete, onArchive }: { crew: Crew; tabs: TerminalTab[]; active: number | null; query: string; onOpen: (row: ScratchTerminal) => void; onDelete: (row: ScratchTerminal) => void; onArchive: (row: ScratchTerminal) => void }) {
  const rows = (useThreads(crew.id).data ?? []).filter((r) => OPENABLE.has(r.agent) || tabs.some((t) => t.scratchId === r.id))
  const [settledOpen, setSettledOpen] = useState(false)
  const [doomed, setDoomed] = useState<ScratchTerminal | null>(null)
  const q = query.trim().toLowerCase()
  const match = (r: ScratchTerminal) => !q || r.title.toLowerCase().includes(q)
  const isOpen = (r: ScratchTerminal) => tabs.some((t) => t.scratchId === r.id)
  const byNew = (a: ScratchTerminal, b: ScratchTerminal) => b.updatedAt - a.updatedAt
  const live = rows.filter((r) => isOpen(r) && match(r)).sort(byNew)
  const settled = rows.filter((r) => !isOpen(r) && r.updatedAt > r.createdAt && match(r)).sort(byNew)
  if (live.length === 0 && settled.length === 0) return null

  const row = (r: ScratchTerminal) => {
    const open = isOpen(r)
    return (
      <div key={r.id} data-thread-row={r.id} aria-current={active === r.id ? 'true' : undefined} className={cn('group/th relative flex h-[26px] items-center rounded-md text-[13px]', active === r.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>
        <button type="button" onClick={() => onOpen(r)} title={r.title} className="flex h-full min-w-0 flex-1 items-center gap-2.5 pr-2 pl-2.5 text-left outline-none">
          <Dot id={r.id} open={open} />
          <span className="min-w-0 flex-1 truncate">{r.title}</span>
          <span className="text-muted-foreground/70 shrink-0 text-[11.5px] group-hover/th:hidden">{shortAge(r.updatedAt)}</span>
        </button>
        {open && (
          <button type="button" aria-label={`Archive ${r.title}`} title="Archive: close it and keep it under Settled" onClick={() => onArchive(r)} className="text-muted-foreground hover:text-foreground mr-0.5 hidden size-5 shrink-0 place-items-center rounded group-hover/th:grid">
            <Archive className="size-3" />
          </button>
        )}
        <button type="button" aria-label={`Delete ${r.title}`} title="Delete this thread" onClick={() => setDoomed(r)} className="text-muted-foreground hover:text-destructive mr-1 hidden size-5 shrink-0 place-items-center rounded group-hover/th:grid">
          <Trash2 className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <div role="group" aria-label={`Threads of ${crew.name}`} className="mt-0.5 mb-1 ml-3 space-y-px">
      {live.map(row)}
      {settled.length > 0 && (
        <>
          <button type="button" aria-expanded={settledOpen || !!q} onClick={() => setSettledOpen((v) => !v)} className="text-muted-foreground hover:text-foreground flex h-[26px] w-full items-center gap-1.5 rounded-md pr-2 pl-2 text-[12.5px]">
            <ChevronRight className={cn('size-3 transition-transform', (settledOpen || !!q) && 'rotate-90')} aria-hidden />
            Settled
            <span className="ml-auto text-[11.5px]">{settled.length}</span>
          </button>
          {(settledOpen || !!q) && settled.map(row)}
        </>
      )}
      <ConfirmDialog
        open={doomed !== null}
        title="Delete this thread?"
        description={doomed ? `"${doomed.title}" and its history will be removed from Foreman. Claude's own session file stays on disk.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => (doomed && onDelete(doomed), setDoomed(null))}
        onCancel={() => setDoomed(null)}
      />
    </div>
  )
}
