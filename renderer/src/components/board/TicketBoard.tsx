import { useState, type DragEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TICKET_MODES, canTransition, type TicketListItem, type TicketMode, type TicketStatus } from '@shared/tickets'
import { call } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { blockedBy, groupByStatus, legalMoves } from '@/lib/ticketColumns'

const ticketsKey = (crewId: number) => ['tickets', crewId]
const VERIFY_TONE = { Pending: 'text-muted-foreground', Passed: 'text-success', Failed: 'text-destructive' } as const

function TicketCard({ ticket, all, onMove, onDragStart }: { ticket: TicketListItem; all: TicketListItem[]; onMove: (to: TicketStatus) => void; onDragStart: (e: DragEvent) => void }) {
  const waiting = blockedBy(ticket, all)
  const moves = legalMoves(ticket)
  return (
    <div draggable={moves.length > 0} onDragStart={onDragStart} data-ticket-card={ticket.id} className="bg-card rounded-[14px] px-4 py-3.5">
      <div className="text-muted-foreground flex items-center gap-2 text-[12px]">
        <span>{ticket.id}</span>
        <span>{ticket.mode}</span>
        <span className={cn('ml-auto', VERIFY_TONE[ticket.verification])}>Verification: {ticket.verification}</span>
      </div>
      <h3 title={ticket.title} className="mt-1 text-[14px] font-semibold break-words">{ticket.title}</h3>
      {ticket.worker && <p className="text-muted-foreground mt-1 text-[12px]">Worker: {ticket.worker}</p>}
      {waiting.length > 0 && <p className="text-warning mt-1 text-[12px]">Blocked by {waiting.join(', ')}</p>}
      {moves.length > 0 && (
        <select
          aria-label={`Move ${ticket.id} to`}
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value as TicketStatus)}
          className="bg-background text-muted-foreground focus-visible:ring-primary/60 mt-2.5 h-7 w-full rounded-md px-2 text-[12.5px] [@media(pointer:coarse)]:min-h-11 outline-none focus-visible:ring-2"
        >
          <option value="">Move to…</option>
          {moves.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
    </div>
  )
}

function NewTicket({ crewId, onDone }: { crewId: number; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [rd, setRd] = useState('')
  const [evalText, setEvalText] = useState('')
  const [mode, setMode] = useState<TicketMode>('Solo')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = title.trim() !== '' && rd.trim() !== '' && evalText.trim() !== ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    const res = await call('tickets:create', crewId, { title: title.trim(), rd, eval: evalText, mode }).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.error)
  }
  const field = 'bg-background focus-visible:ring-primary/60 w-full rounded-md px-3 py-2 text-[13px] outline-none focus-visible:ring-2'
  return (
    <form onSubmit={submit} aria-label="New ticket" className="bg-card mt-4 flex shrink-0 flex-col gap-2.5 rounded-[14px] p-4">
      <input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      <textarea aria-label="Requirements" placeholder="Requirements" rows={3} value={rd} onChange={(e) => setRd(e.target.value)} className={field} />
      <textarea aria-label="Eval checklist" placeholder="Eval checklist (- [ ] items)" rows={3} value={evalText} onChange={(e) => setEvalText(e.target.value)} className={field} />
      <div className="flex items-center gap-3">
        <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value as TicketMode)} className="bg-background h-8 rounded-md px-2 text-[13px]">
          {TICKET_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button type="submit" disabled={!ready || busy} className="bg-primary text-primary-foreground h-8 rounded-full px-4 text-[13px] disabled:opacity-50">Create</button>
        <button type="button" onClick={onDone} className="text-muted-foreground hover:text-foreground h-8 px-2 text-[13px]">Cancel</button>
        {error && <span role="alert" className="text-destructive text-[12.5px]">{error}</span>}
      </div>
    </form>
  )
}

// The tickets of the open project as one column per status. Polls, as there is no push event for the ticket files.
export function TicketBoard({ crewId }: { crewId: number | null }) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const list = useQuery({ queryKey: ticketsKey(crewId ?? -1), queryFn: () => call('tickets:list', crewId!), enabled: crewId !== null, refetchInterval: 3000 })
  const tickets = list.data?.tickets ?? []
  const skipped = list.data?.skipped ?? []

  const move = async (t: TicketListItem, to: TicketStatus) => {
    if (crewId === null || !canTransition(t.status, to) || !legalMoves(t).includes(to)) return
    const res = await call('tickets:setStatus', crewId, t.id, to).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    setError(res.ok ? '' : `${t.id}: ${res.error}`)
    void qc.invalidateQueries({ queryKey: ticketsKey(crewId) })
  }
  const drop = (e: DragEvent, to: TicketStatus) => {
    e.preventDefault()
    const t = tickets.find((x) => x.id === e.dataTransfer.getData('text/plain'))
    if (t && t.status !== to) void move(t, to)
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col px-4 pt-11 pb-4 md:px-14" aria-label="Ticket board">
      <div className="flex shrink-0 items-center gap-4">
        <h2 className="text-[15px] font-semibold">Tickets</h2>
        {crewId !== null && !adding && <button type="button" onClick={() => setAdding(true)} className="bg-accent text-foreground ml-auto h-8 rounded-full px-4 text-[13px] [@media(pointer:coarse)]:min-h-11">New ticket</button>}
      </div>
      {skipped.length > 0 && (
        <p role="alert" className="bg-warning/15 text-warning mt-3 shrink-0 rounded-md px-3 py-2 text-[13px]">{skipped.length} unreadable board lines, writes are blocked</p>
      )}
      {error && <p role="alert" className="text-destructive mt-3 shrink-0 text-[13px]">{error}</p>}
      {adding && crewId !== null && <NewTicket crewId={crewId} onDone={() => (setAdding(false), void qc.invalidateQueries({ queryKey: ticketsKey(crewId) }))} />}
      {crewId === null ? (
        <p className="text-muted-foreground mt-7 text-[13px]">No project open.</p>
      ) : list.error ? (
        <p role="alert" className="text-destructive mt-7 text-[13px]">Could not load tickets: {list.error instanceof Error ? list.error.message : String(list.error)}</p>
      ) : list.isPending ? (
        <p className="text-muted-foreground mt-7 text-[13px]">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="text-muted-foreground mt-7 text-[13px]">No tickets yet. Use New ticket to add one.</p>
      ) : (
        <div className="mt-6 flex min-h-0 flex-1 gap-4 overflow-x-auto">
          {groupByStatus(tickets).map((col) => (
            <div key={col.status} role="group" aria-label={col.status} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, col.status)} className="flex w-60 shrink-0 flex-col">
              <h3 className="text-muted-foreground mb-2 shrink-0 text-[13px]">{col.status} {col.tickets.length}</h3>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
                {col.tickets.map((t) => (
                  <TicketCard key={t.id} ticket={t} all={tickets} onMove={(to) => void move(t, to)} onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
