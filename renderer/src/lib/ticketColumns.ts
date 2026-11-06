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

// A new ticket (Draft or Ready) with no worker can be started from the board.
export function canStart(ticket: Pick<TicketListItem, 'status' | 'worker'>): boolean {
  return (ticket.status === 'Draft' || ticket.status === 'Ready') && !ticket.worker
}

// The first message of a thread that works one ticket. The thread drives the tickets CLI itself.
export function buildLaunchPrompt(ticket: Pick<TicketListItem, 'id' | 'title'>): string {
  const cli = 'node .claude/foreman/tickets.mjs'
  return [
    `Work on ticket ${ticket.id}: ${ticket.title}.`,
    `1. Run \`${cli} show ${ticket.id}\` and read its requirements (rd) and eval checklist.`,
    `2. Run \`${cli} claim ${ticket.id} claude:${ticket.id}\`.`,
    `3. If this is a git project, run \`${cli} worktree create ${ticket.id}\` and do all the work in that worktree. If it prints {"isolation":"none"}, work in place.`,
    `4. Do the work so every eval criterion is met. Do not edit eval.md. Do not edit .foreman/tickets by hand: use the CLI.`,
    `5. When done, report each eval criterion with evidence.`,
  ].join('\n')
}

// Dependencies that are not Done yet, i.e. what still blocks the ticket.
export function blockedBy(ticket: TicketListItem, tickets: readonly TicketListItem[]): string[] {
  return ticket.dependsOn.filter((d) => tickets.find((t) => t.id === d.id)?.status !== 'Done').map((d) => d.id)
}
