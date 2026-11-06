import type { TicketRow } from '../shared/tickets'

// Decides which tickets may start next. Pure: no files, no clock. Call it again with fresh rows to re-evaluate.

export interface PlanOptions {
  maxWorkers: number
  // Paths each ticket will edit (files, or folders that cover everything below them).
  touches?: Record<string, string[]>
}

export interface Waiting {
  id: string
  reason: string
}

export interface Plan {
  start: string[]
  waiting: Waiting[]
}

const byId = (rows: readonly TicketRow[]): Map<string, TicketRow> => new Map(rows.map((r) => [r.id, r]))

// Longest chain of dependencies below each ticket (0 = depends on nothing). A cycle or unknown id adds nothing.
export function dependencyDepth(rows: readonly TicketRow[]): Map<string, number> {
  const map = byId(rows)
  const depth = new Map<string, number>()
  const visit = (id: string, path: Set<string>): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (path.has(id)) return 0
    path.add(id)
    let d = 0
    for (const dep of map.get(id)?.dependsOn ?? []) if (map.has(dep.id)) d = Math.max(d, visit(dep.id, path) + 1)
    path.delete(id)
    depth.set(id, d)
    return d
  }
  for (const r of rows) visit(r.id, new Set())
  return depth
}

// Dependencies first; ties by id, so the order is the same every time.
export function topologicalOrder(rows: readonly TicketRow[]): string[] {
  const depth = dependencyDepth(rows)
  return rows.map((r) => r.id).sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || a.localeCompare(b))
}

// Everything that depends on `id`, directly or through other tickets.
export function downstreamOf(rows: readonly TicketRow[], id: string): string[] {
  const out = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const r of rows) {
      if (out.has(r.id) || r.id === id || !r.dependsOn.some((d) => d.id === cur)) continue
      out.add(r.id)
      queue.push(r.id)
    }
  }
  return [...out].sort()
}

function upstreamOf(map: Map<string, TicketRow>, id: string): Set<string> {
  const out = new Set<string>()
  const queue = [id]
  while (queue.length) {
    for (const dep of map.get(queue.shift()!)?.dependsOn ?? []) {
      if (out.has(dep.id) || dep.id === id) continue
      out.add(dep.id)
      queue.push(dep.id)
    }
  }
  return out
}

// Backslashes, repeated slashes and "." segments are folded away so a//b and a/./b match a/b.
const clean = (p: string): string =>
  p
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/(^|\/)(\.(\/|$))+/g, '$1')
    .replace(/\/+$/, '')
    .toLowerCase()

// The more specific path of the first overlapping pair (same path, or one is a folder above the other), or null.
function overlap(a: readonly string[] = [], b: readonly string[] = []): string | null {
  for (const x of a.map(clean).filter(Boolean)) {
    for (const y of b.map(clean).filter(Boolean)) {
      if (x === y || y.startsWith(`${x}/`)) return y
      if (x.startsWith(`${y}/`)) return x
    }
  }
  return null
}

export function planNext(tickets: readonly TicketRow[], opts: PlanOptions): Plan {
  const map = byId(tickets)
  const order = topologicalOrder(tickets)
  // NaN or a non-number must not switch the cap off: it falls back to the default of 3.
  const max = Number.isFinite(opts.maxWorkers) ? Math.min(8, Math.max(1, Math.floor(opts.maxWorkers))) : 3
  const touches = opts.touches ?? {}
  const failed = tickets.filter((t) => t.status === 'Failed').map((t) => t.id)
  const brokenBy = new Map<string, string>()
  for (const f of failed) for (const id of downstreamOf(tickets, f)) if (!brokenBy.has(id)) brokenBy.set(id, f)

  const running = tickets.filter((t) => t.status === 'In Progress').map((t) => t.id)
  const start: string[] = []
  const waiting: Waiting[] = []
  const related = (a: string, b: string): boolean => upstreamOf(map, a).has(b) || upstreamOf(map, b).has(a)
  // Ready tickets whose own dependencies are done: the only ones that can compete for a slot or a file.
  const eligible = (t: TicketRow): boolean =>
    t.status === 'Ready' && !brokenBy.has(t.id) && t.dependsOn.every((d) => map.get(d.id)?.status === 'Done')

  for (const id of order) {
    const t = map.get(id)!
    const failedUp = brokenBy.get(id)
    if (failedUp && (t.status === 'Ready' || t.status === 'Draft')) {
      waiting.push({ id, reason: `blocked by failed ${failedUp}` })
      continue
    }
    if (t.status !== 'Ready') continue
    const pending = t.dependsOn.filter((d) => map.get(d.id)?.status !== 'Done')
    if (pending.length) {
      waiting.push({ id, reason: `waiting on ${pending.map((d) => `${d.id} (${map.get(d.id)?.status ?? 'missing'})`).join(', ')}` })
      continue
    }
    // Running tickets and tickets about to start always win; of two waiting tickets the lower id goes first.
    const rivals = [...running, ...start, ...tickets.filter((o) => o.id < id && eligible(o)).map((o) => o.id)]
    let clash: Waiting | null = null
    for (const other of rivals) {
      if (other === id || related(id, other)) continue
      const path = overlap(touches[id], touches[other])
      if (path) {
        clash = { id, reason: `overlaps ${other} on ${path}` }
        break
      }
    }
    if (clash) {
      waiting.push(clash)
      continue
    }
    if (running.length + start.length >= max) {
      waiting.push({ id, reason: `cap ${max} of ${max} in use` })
      continue
    }
    start.push(id)
  }
  return { start, waiting }
}
