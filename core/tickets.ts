import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, statSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TICKET_INTEGRATIONS,
  TICKET_MODES,
  TICKET_STATUSES,
  TICKET_VERIFICATIONS,
  canTransition,
  type TicketDependency,
  type TicketDetail,
  type TicketIntegration,
  type TicketList,
  type TicketListItem,
  type TicketMode,
  type TicketRow,
  type TicketStatus,
  type TicketVerification,
} from '../shared/tickets'

const ID_RE = /^T-\d{3,}$/
const COLUMNS = ['ID', 'Title', 'Status', 'Mode', 'Depends on', 'Worker', 'Branch', 'Worktree', 'Verification', 'Integration'] as const

export function ticketsDir(folder: string): string {
  return join(folder, '.foreman', 'tickets')
}

// Ids become folder names, so anything that is not exactly T-<digits> is refused (no separators, no "..").
function assertId(id: string): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`Invalid ticket id: ${String(id)}`)
}

function ticketPath(folder: string, id: string): string {
  assertId(id)
  return join(ticketsDir(folder), id)
}

// Write to a temp file then rename, so a crash never leaves a half-written file.
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

// Append-only event log next to the ticket's other files: one line per event, newest last.
function logEvent(folder: string, id: string, text: string): void {
  const dir = ticketPath(folder, id)
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'log.md'), `${new Date().toISOString()} ${text.replace(/\s+/g, ' ')}`+String.fromCharCode(10), 'utf8')
}

// ---------- board.md: parse and serialise ----------

// Pipes inside a cell are written \| so a title can hold one.
function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

function parseDeps(text: string): TicketDependency[] {
  const out: TicketDependency[] = []
  for (const part of text.split(';')) {
    const p = part.trim()
    if (!p) continue
    const colon = p.indexOf(':')
    if (colon === -1) {
      for (const id of p.split(',')) if (id.trim()) out.push({ id: id.trim(), reason: '' })
    } else out.push({ id: p.slice(0, colon).trim(), reason: p.slice(colon + 1).trim() })
  }
  return out
}

function formatDeps(deps: TicketDependency[]): string {
  // ";" separates entries, so it cannot appear inside a reason.
  return deps.map((d) => (d.reason ? `${d.id}: ${d.reason.replace(/;/g, ',')}` : d.id)).join('; ')
}

// A column the board does not have defaults; a column that is there must hold a known value, so a blanked cell is never guessed.
function oneOf<T extends string>(list: readonly T[], value: string | undefined, fallback: T): T | null {
  if (value === undefined) return fallback
  return list.find((v) => v.toLowerCase() === value.toLowerCase()) ?? null
}

// Never throws: lines it cannot use are returned in `skipped`.
export function parseBoard(text: string): { rows: TicketRow[]; skipped: string[] } {
  const rows: TicketRow[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  let index: Record<string, number> | null = null
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // Text outside the table is kept out of the rows but reported, so a write cannot silently delete it.
    if (!line.startsWith('|')) {
      skipped.push(raw)
      continue
    }
    const cells = splitCells(line)
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue
    if (!index) {
      const names = cells.map((c) => c.toLowerCase())
      if (['id', 'title', 'status'].every((n) => names.includes(n))) {
        index = {}
        cells.forEach((c, i) => {
          index![c.toLowerCase()] = i
        })
      } else skipped.push(raw)
      continue
    }
    const get = (name: string): string | undefined => {
      const i = index![name.toLowerCase()]
      return i === undefined ? undefined : (cells[i] ?? '')
    }
    const id = get('ID') ?? ''
    const status = oneOf(TICKET_STATUSES, get('Status'), 'Draft')
    const mode = oneOf(TICKET_MODES, get('Mode'), 'Solo')
    const verification = oneOf(TICKET_VERIFICATIONS, get('Verification'), 'Pending')
    const integration = oneOf(TICKET_INTEGRATIONS, get('Integration'), 'Pending')
    if (!ID_RE.test(id) || seen.has(id) || !status || !mode || !verification || !integration) {
      skipped.push(raw)
      continue
    }
    seen.add(id)
    rows.push({
      id,
      title: get('Title') ?? '',
      status,
      mode,
      dependsOn: parseDeps(get('Depends on') ?? ''),
      worker: get('Worker') ?? '',
      branch: get('Branch') ?? '',
      worktree: get('Worktree') ?? '',
      verification,
      integration,
    })
  }
  return { rows, skipped }
}

export function serialiseBoard(rows: TicketRow[]): string {
  const lines = [
    `| ${COLUMNS.join(' | ')} |`,
    `| ${COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (r) =>
        `| ${[r.id, cell(r.title), r.status, r.mode, cell(formatDeps(r.dependsOn)), cell(r.worker), cell(r.branch), cell(r.worktree), r.verification, r.integration].join(' | ')} |`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

// ---------- dependencies ----------

// Returns the ids of one cycle (first id repeated at the end), or null.
export function detectCycle(rows: TicketRow[]): string[] | null {
  const deps = new Map(rows.map((r) => [r.id, r.dependsOn.map((d) => d.id)]))
  const state = new Map<string, 1 | 2>() // 1 = on the current path, 2 = finished
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id]
    state.set(id, 1)
    path.push(id)
    for (const next of deps.get(id) ?? []) {
      if (!deps.has(next)) continue
      const found = visit(next)
      if (found) return found
    }
    path.pop()
    state.set(id, 2)
    return null
  }
  for (const id of deps.keys()) {
    const found = visit(id)
    if (found) return found
  }
  return null
}

// Throws on an unknown id, a self-dependency or a cycle. `rows` is the board with `id` already in it.
export function validateDependencies(rows: TicketRow[], id: string): void {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`Unknown ticket: ${id}`)
  for (const dep of row.dependsOn) {
    if (dep.id === id) throw new Error(`${id} cannot depend on itself`)
    if (!rows.some((r) => r.id === dep.id)) throw new Error(`${id} depends on unknown ticket ${dep.id}`)
  }
  const cycle = detectCycle(rows)
  if (cycle) throw new Error(`Dependency cycle: ${cycle.join(' -> ')}`)
}

// ---------- store ----------

function readBoard(folder: string): { rows: TicketRow[]; skipped: string[] } {
  const file = join(ticketsDir(folder), 'board.md')
  if (!existsSync(file)) return { rows: [], skipped: [] }
  return parseBoard(readFileSync(file, 'utf8'))
}

// Writes are rare and short, so a blocking wait between retries is fine.
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const LOCK_WAIT_MS = 2000
const LOCK_STALE_MS = 30_000

// Rename first, then delete the renamed copy: a second waiter never unlinks the lock path itself,
// so it cannot delete a fresh lock that the first waiter has just taken.
export function removeStale(lock: string): void {
  const moved = `${lock}.stale-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    renameSync(lock, moved)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return // already gone; the caller retries
    throw e
  }
  rmSync(moved, { force: true })
}

// Cross-process lock for read-modify-write: workers in other processes edit the same board.md.
function withLock<T>(folder: string, fn: () => T): T {
  mkdirSync(ticketsDir(folder), { recursive: true })
  const lock = join(ticketsDir(folder), '.lock')
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'))
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      try {
        // A holder that died leaves the file behind; after 30s it is stale.
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) removeStale(lock)
        else if (Date.now() >= deadline) throw new Error('board.md is locked by another process; try again')
        else sleep(25)
      } catch (inner) {
        if ((inner as NodeJS.ErrnoException).code !== 'ENOENT') throw inner
      }
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lock, { force: true })
  }
}

function writeBoard(folder: string, rows: TicketRow[]): void {
  mkdirSync(ticketsDir(folder), { recursive: true })
  writeAtomic(join(ticketsDir(folder), 'board.md'), serialiseBoard(rows))
}

// A write saves only the rows that parsed, so refuse when lines were skipped rather than drop a hand edit unseen.
function loadForWrite(folder: string): TicketRow[] {
  const { rows, skipped } = readBoard(folder)
  if (skipped.length) throw new Error(`${join(ticketsDir(folder), 'board.md')} has ${skipped.length} line(s) that cannot be read (first: ${skipped[0]?.trim()}). Fix or delete the unreadable lines, then retry.`)
  return rows
}

function nextId(folder: string, rows: TicketRow[]): string {
  let max = 0
  const note = (id: string): void => {
    if (ID_RE.test(id)) max = Math.max(max, Number(id.slice(2)))
  }
  rows.forEach((r) => note(r.id))
  // A ticket folder without a board row still owns its id.
  if (existsSync(ticketsDir(folder))) readdirSync(ticketsDir(folder)).forEach(note)
  return `T-${String(max + 1).padStart(3, '0')}`
}

export interface NewTicket {
  title: string
  rd: string
  eval: string
  dependsOn?: TicketDependency[]
  mode?: TicketMode
}

export function createTicket(folder: string, input: NewTicket): TicketRow {
  if (!input.title?.trim()) throw new Error('A ticket needs a title')
  if (!input.eval?.trim()) throw new Error('A ticket needs acceptance criteria (eval.md cannot be empty)')
  const mode = input.mode ?? 'Solo'
  if (!TICKET_MODES.includes(mode)) throw new Error(`Invalid mode: ${String(mode)}`)
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const id = nextId(folder, rows)
    const row: TicketRow = {
      id,
      title: input.title.trim(),
      status: 'Draft',
      mode,
      dependsOn: (input.dependsOn ?? []).map((d) => ({ id: d.id, reason: d.reason ?? '' })),
      worker: '',
      branch: '',
      worktree: '',
      verification: 'Pending',
      integration: 'Pending',
    }
    const next = [...rows, row]
    validateDependencies(next, id)
    const dir = ticketPath(folder, id)
    mkdirSync(dir, { recursive: true })
    try {
      writeAtomic(join(dir, 'rd.md'), input.rd ?? '')
      writeAtomic(join(dir, 'eval.md'), input.eval)
      // Empty on purpose: the worker fills it with decisions, assumptions, files touched and validation.
      writeAtomic(join(dir, 'notes.md'), '')
      logEvent(folder, id, 'created')
      writeBoard(folder, next)
    } catch (e) {
      // No board row means no ticket, so do not leave its folder behind.
      rmSync(dir, { recursive: true, force: true })
      throw e
    }
    return row
  })
}

function find(rows: TicketRow[], id: string): TicketRow {
  assertId(id)
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`Unknown ticket: ${id}`)
  return row
}

export function setStatus(folder: string, id: string, status: TicketStatus): TicketRow {
  if (!TICKET_STATUSES.includes(status)) throw new Error(`Invalid status: ${String(status)}`)
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const row = find(rows, id)
    if (!canTransition(row.status, status)) throw new Error(`${id}: ${row.status} cannot go to ${status}`)
    if (status === 'Done' && !(row.verification === 'Passed' && (row.integration === 'Merged' || row.integration === 'Not needed'))) {
      throw new Error(`${id} cannot be Done until verification is Passed and integration is Merged or Not needed`)
    }
    const updated = { ...row, status }
    writeBoard(folder, rows.map((r) => (r.id === id ? updated : r)))
    logEvent(folder, id, `status ${row.status} -> ${status}`)
    return updated
  })
}

// Takes a Ready ticket whose dependencies are all Done. Under the lock, so two workers (even in two processes) never both win.
export function claimTicket(folder: string, id: string, workerId: string): TicketRow {
  if (typeof workerId !== 'string' || !workerId.trim()) throw new Error('A claim needs a worker id')
  const worker = workerId.trim()
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const row = find(rows, id)
    if (row.status !== 'Ready') {
      throw new Error(row.status === 'In Progress' ? `${id} is already claimed${row.worker ? ` by ${row.worker}` : ''}` : `${id} is ${row.status}, only a Ready ticket can be claimed`)
    }
    const waiting = row.dependsOn.filter((d) => rows.find((r) => r.id === d.id)?.status !== 'Done').map((d) => d.id)
    if (waiting.length) throw new Error(`${id} is waiting on ${waiting.join(', ')}`)
    const updated: TicketRow = { ...row, status: 'In Progress', worker }
    writeBoard(folder, rows.map((r) => (r.id === id ? updated : r)))
    logEvent(folder, id, `claimed by ${worker}`)
    return updated
  })
}

// A worker gives the ticket back cleanly. Only the worker that holds it can.
export function releaseTicket(folder: string, id: string, workerId: string): TicketRow {
  // Trimmed like claimTicket trims it, so the id a worker claimed with always matches.
  const worker = typeof workerId === 'string' ? workerId.trim() : ''
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const row = find(rows, id)
    if (row.status !== 'In Progress') throw new Error(`${id} is ${row.status}, only an In Progress ticket can be released`)
    if (row.worker !== worker) throw new Error(`${id} is held by ${row.worker || 'no worker'}, not ${worker}`)
    const updated: TicketRow = { ...row, status: 'Ready', worker: '' }
    writeBoard(folder, rows.map((r) => (r.id === id ? updated : r)))
    logEvent(folder, id, `released by ${worker}`)
    return updated
  })
}

// After a restart: In Progress tickets whose worker is not live go back to Ready. Review tickets are finished work and stay.
// This is the only path from In Progress to Ready besides a clean release; the public transition table does not allow it.
export function recoverTickets(folder: string, liveWorkerIds: ReadonlySet<string>): string[] {
  if (!existsSync(join(ticketsDir(folder), 'board.md'))) return []
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const recovered: string[] = []
    const next = rows.map((r) => {
      if (r.status !== 'In Progress' || (r.worker && liveWorkerIds.has(r.worker))) return r
      recovered.push(r.id)
      return { ...r, status: 'Ready' as const, worker: '' }
    })
    if (!recovered.length) return recovered
    writeBoard(folder, next)
    for (const id of recovered) logEvent(folder, id, 'interrupted: worker gone')
    return recovered
  })
}

// ---------- eval.md: the acceptance contract ----------
// eval.md is a checklist. A criterion is a list line with one box and some text: "- [ ] text", "* [x] text", "1. [ ] text", "2) [ ] text"
// (list markers - * + N. N)). The scanner does no markdown parsing at all (no fences, quotes or comments), so nothing can hide
// a criterion: every other box token in the file is a problem, and problems block Passed.

export interface Criterion {
  index: number // 1-based, in file order
  text: string
  met: boolean
}

const CRITERION_RE = /^([ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\][ \t]+)(\S.*)$/
// A box token: "[ ]", "[x]", "[X]", also with a no-break or other Unicode space inside the brackets.
const BOX_TOKEN_RE = /\[[ \t   -   　xX]\]/
// A Unicode ballot box at the start of a line (after indent and an optional list marker).
const BALLOT_RE = /^[\s ]*(?:(?:[-*+]|\d+[.)])[\s ]*)?[☐☑☒]/
const BOM = String.fromCharCode(0xfeff)

const FIX = 'write criteria as "- [ ] text" lines; remove other [ ] tokens from eval.md'

function scanCriteria(text: string): { found: Array<{ line: number; match: RegExpExecArray }>; problems: string[] } {
  const found: Array<{ line: number; match: RegExpExecArray }> = []
  const problems: string[] = []
  const body = text.startsWith(BOM) ? text.slice(1) : text
  body.split(String.fromCharCode(10)).forEach((raw, line) => {
    const row = raw.endsWith(String.fromCharCode(13)) ? raw.slice(0, -1) : raw
    const match = CRITERION_RE.exec(row)
    // On a criterion line only the text after its own box is checked; anywhere else the whole line is.
    const rest = match ? (match[4] ?? '') : row
    if (match) found.push({ line, match })
    if (BOX_TOKEN_RE.test(rest) || (!match && BALLOT_RE.test(row))) {
      problems.push(`eval.md line ${line + 1}: unexpected checkbox in "${row.trim().slice(0, 40)}"; ${FIX}`)
    }
  })
  return { found, problems }
}

// Never throws: a missing or unreadable eval.md has no criteria. `problems` lists anything that makes the file unsafe to trust.
export function readCriteria(folder: string, id: string): { total: number; met: number; items: Criterion[]; problems: string[] } {
  let text = ''
  try {
    text = readFileSync(join(ticketPath(folder, id), 'eval.md'), 'utf8')
  } catch {
    // no criteria
  }
  const { found, problems } = scanCriteria(text)
  const items: Criterion[] = found.map(({ match: m }, i) => ({ index: i + 1, text: (m[4] ?? '').trim(), met: m[2] !== ' ' }))
  return { total: items.length, met: items.filter((i) => i.met).length, items, problems }
}

// Ticks or unticks criterion `index` (1-based) and logs the evidence, under the lock.
export function markCriterion(folder: string, id: string, index: number, met: boolean, evidence: string, actor = ''): Criterion {
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('A criterion needs evidence')
  return withLock(folder, () => {
    find(readBoard(folder).rows, id)
    const file = join(ticketPath(folder, id), 'eval.md')
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const { total, problems } = readCriteria(folder, id)
    // Marking met while part of the file is unreadable could hide an unmet criterion; marking unmet is always safe.
    if (met && problems.length) throw new Error(problems[0])
    if (!Number.isInteger(index) || index < 1 || index > total) throw new Error(`${id}: criterion ${String(index)} is out of range (eval.md has ${total})`)
    const bom = text.startsWith(BOM)
    const body = bom ? text.slice(1) : text
    const lines = body.split(String.fromCharCode(10))
    const hit = scanCriteria(body).found[index - 1]!
    const m = hit.match
    const raw = lines[hit.line]!
    // Only the box character changes: marker, indent, spacing and line ending stay as written.
    const at = (m[1] ?? '').length
    lines[hit.line] = `${raw.slice(0, at)}${met ? 'x' : ' '}${raw.slice(at + 1)}`
    const item: Criterion = { index, text: (m[4] ?? '').trim(), met }
    const next = (bom ? BOM : '') + lines.join(String.fromCharCode(10))
    writeAtomic(file, next)
    logEvent(folder, id, `criterion ${index} ${met ? 'met' : 'unmet'}${actor ? ` by ${actor}` : ''}: ${evidence.trim()}`)
    return item
  })
}

// Sets verification. Passed is checked against eval.md in the same lock hold as the write, so a criterion change cannot slip in between.
export function setVerification(folder: string, id: string, verification: TicketVerification): TicketRow {
  if (!TICKET_VERIFICATIONS.includes(verification)) throw new Error(`Invalid verification: ${String(verification)}`)
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const row = find(rows, id)
    if (verification === 'Passed') {
      const c = readCriteria(folder, id)
      if (c.problems.length) throw new Error(c.problems[0])
      if (!c.total) throw new Error(`eval.md of ${id} has no "- [ ] criterion" lines`)
      if (c.met < c.total) throw new Error(`${c.total - c.met} of ${c.total} criteria not met (${c.items.filter((i) => !i.met).map((i) => i.index).join(', ')})`)
    }
    const updated: TicketRow = { ...row, verification }
    writeBoard(folder, rows.map((r) => (r.id === id ? updated : r)))
    if (verification !== row.verification) logEvent(folder, id, `verification ${row.verification} -> ${verification}`)
    return updated
  })
}

// Router only: moves a running ticket to another worker (a Reproducer). The old worker must already be finished or stopped.
export function handoffTicket(folder: string, id: string, from: string, to: string): TicketRow {
  const a = typeof from === 'string' ? from.trim() : ''
  const b = typeof to === 'string' ? to.trim() : ''
  if (!a || !b) throw new Error('A handoff needs a from and a to worker')
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const row = find(rows, id)
    if (row.status !== 'In Progress') throw new Error(`${id} is ${row.status}, only an In Progress ticket can be handed off`)
    if (row.worker !== a) throw new Error(`${id} is held by ${row.worker || 'no worker'}, not ${a}`)
    const updated: TicketRow = { ...row, worker: b }
    writeBoard(folder, rows.map((r) => (r.id === id ? updated : r)))
    logEvent(folder, id, `handed off from ${a} to ${b}`)
    return updated
  })
}

export interface TicketPatch {
  title?: string
  mode?: TicketMode
  dependsOn?: TicketDependency[]
  worker?: string
  branch?: string
  worktree?: string
  verification?: TicketVerification
  integration?: TicketIntegration
}

// Status is not patchable here: it only moves through setStatus.
export function updateTicket(folder: string, id: string, patch: TicketPatch): TicketRow {
  return withLock(folder, () => {
    const rows = loadForWrite(folder)
    const row = find(rows, id)
    if (patch.mode !== undefined && !TICKET_MODES.includes(patch.mode)) throw new Error(`Invalid mode: ${String(patch.mode)}`)
    if (patch.verification !== undefined && !TICKET_VERIFICATIONS.includes(patch.verification)) throw new Error(`Invalid verification: ${String(patch.verification)}`)
    if (patch.integration !== undefined && !TICKET_INTEGRATIONS.includes(patch.integration)) throw new Error(`Invalid integration: ${String(patch.integration)}`)
    if (patch.title !== undefined && !patch.title.trim()) throw new Error('A ticket needs a title')
    const updated: TicketRow = {
      ...row,
      ...(patch.title !== undefined && { title: patch.title.trim() }),
      ...(patch.mode !== undefined && { mode: patch.mode }),
      ...(patch.dependsOn !== undefined && { dependsOn: patch.dependsOn.map((d) => ({ id: d.id, reason: d.reason ?? '' })) }),
      ...(patch.worker !== undefined && { worker: patch.worker }),
      ...(patch.branch !== undefined && { branch: patch.branch }),
      ...(patch.worktree !== undefined && { worktree: patch.worktree }),
      ...(patch.verification !== undefined && { verification: patch.verification }),
      ...(patch.integration !== undefined && { integration: patch.integration }),
    }
    const next = rows.map((r) => (r.id === id ? updated : r))
    validateDependencies(next, id)
    writeBoard(folder, next)
    if (updated.verification !== row.verification) logEvent(folder, id, `verification ${row.verification} -> ${updated.verification}`)
    return updated
  })
}

function withFiles(folder: string, row: TicketRow): TicketListItem {
  const dir = join(ticketsDir(folder), row.id)
  return { ...row, hasRd: existsSync(join(dir, 'rd.md')), hasEval: existsSync(join(dir, 'eval.md')) }
}

export function listTickets(folder: string): TicketList {
  const { rows, skipped } = readBoard(folder)
  return { tickets: rows.map((r) => withFiles(folder, r)), skipped }
}

// The paths a ticket will edit, from an optional "Touches: a, b" line in its rd.md. Missing file or line = none.
export function readTouches(folder: string, id: string): string[] {
  const file = join(ticketPath(folder, id), 'rd.md')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return [] // a missing or unreadable rd.md must not fail the whole plan
  }
  const line = text.split(/\r?\n/).find((l) => /^\s*touches\s*:/i.test(l))
  if (!line) return []
  return line
    .slice(line.indexOf(':') + 1)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

export function getTicket(folder: string, id: string): TicketDetail {
  const row = find(readBoard(folder).rows, id)
  const dir = ticketPath(folder, id)
  const read = (name: string): string => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '')
  return { ticket: withFiles(folder, row), rd: read('rd.md'), eval: read('eval.md') }
}
