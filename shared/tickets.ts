// Model Engine tickets. The markdown files under <project>/.foreman/tickets are the source of truth.

export const TICKET_STATUSES = ['Draft', 'Ready', 'In Progress', 'Blocked', 'Review', 'Done', 'Failed'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_MODES = ['Solo', 'Team'] as const
export type TicketMode = (typeof TICKET_MODES)[number]

export const TICKET_VERIFICATIONS = ['Pending', 'Passed', 'Failed'] as const
export type TicketVerification = (typeof TICKET_VERIFICATIONS)[number]

export const TICKET_INTEGRATIONS = ['Pending', 'Merged', 'Failed', 'Not needed'] as const
export type TicketIntegration = (typeof TICKET_INTEGRATIONS)[number]

// Legal moves only; Done is terminal.
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  Draft: ['Ready'],
  Ready: ['In Progress', 'Blocked'],
  'In Progress': ['Review', 'Blocked', 'Failed'],
  Review: ['Done', 'In Progress', 'Failed'],
  Blocked: ['Ready', 'In Progress'],
  Failed: ['Ready', 'Draft'],
  Done: [],
}

// One dependency: the ticket id, plus why it is needed (text after a colon on the board).
export interface TicketDependency {
  id: string
  reason: string
}

export interface TicketRow {
  id: string
  title: string
  status: TicketStatus
  mode: TicketMode
  dependsOn: TicketDependency[]
  worker: string
  branch: string
  worktree: string
  verification: TicketVerification
  integration: TicketIntegration
}

export interface TicketListItem extends TicketRow {
  hasRd: boolean
  hasEval: boolean
}

export interface TicketList {
  tickets: TicketListItem[]
  // Board lines that could not be read, so a hand edit never disappears silently.
  skipped: string[]
}

export interface TicketDetail {
  ticket: TicketListItem
  rd: string
  eval: string
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to)
}
