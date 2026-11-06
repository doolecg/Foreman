import { TICKET_STATUSES, TICKET_TRANSITIONS, type TicketListItem, type TicketStatus } from '@shared/tickets'

// One bucket per status, in column order; tickets keep their board order inside a column.
export function groupByStatus(tickets: readonly TicketListItem[]): Array<{ status: TicketStatus; tickets: TicketListItem[] }> {
  return TICKET_STATUSES.map((status) => ({ status, tickets: tickets.filter((t) => t.status === status) }))
}

// Same rule as setStatus in core/tickets.ts: Done needs a passed verification and a merged (or not needed) integration.
export function legalMoves(ticket: Pick<TicketListItem, 'status' | 'verification' | 'integration'>): TicketStatus[] {
  const doneOk = ticket.verification === 'Passed' && (ticket.integration === 'Merged' || ticket.integration === 'Not needed')
  return TICKET_TRANSITIONS[ticket.status].filter((s) => s !== 'Done' || doneOk)
}

// Dependencies that are not Done yet, i.e. what still blocks the ticket.
export function blockedBy(ticket: TicketListItem, tickets: readonly TicketListItem[]): string[] {
  return ticket.dependsOn.filter((d) => tickets.find((t) => t.id === d.id)?.status !== 'Done').map((d) => d.id)
}
