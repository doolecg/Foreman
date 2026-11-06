import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimTicket, createTicket, detectCycle, getTicket, handoffTicket, listTickets, markCriterion, parseBoard, readCriteria, readTouches, recoverTickets, releaseTicket, serialiseBoard, setStatus, setVerification, ticketsDir, updateTicket } from './tickets'
import type { TicketRow } from '../shared/tickets'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'foreman-tickets-'))
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const make = (title = 'A', extra: Partial<Parameters<typeof createTicket>[1]> = {}) =>
  createTicket(folder, { title, rd: '# rd', eval: '- it works', ...extra })

// Polls with a deadline so a child that never starts fails the test with a message instead of hanging it.
async function waitFor(done: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms}ms waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const row = (id: string, deps: string[] = []): TicketRow => ({
  id,
  title: id,
  status: 'Draft',
  mode: 'Solo',
  dependsOn: deps.map((d) => ({ id: d, reason: '' })),
  worker: '',
  branch: '',
  worktree: '',
  verification: 'Pending',
  integration: 'Pending',
})

describe('board.md', () => {
  it('round-trips, including pipes, reasons and dependencies', () => {
    const rows: TicketRow[] = [
      row('T-001'),
      { ...row('T-002', ['T-001']), title: 'a | b', status: 'In Progress', mode: 'Team', worker: 'w1', branch: 'feat/x', worktree: 'wt', dependsOn: [{ id: 'T-001', reason: 'needs the store' }] },
    ]
    const parsed = parseBoard(serialiseBoard(rows))
    expect(parsed.skipped).toEqual([])
    expect(parsed.rows).toEqual(rows)
  })

  it('tolerates hand edits: spacing, extra columns, reordered columns, case (stray text is reported)', () => {
    const text = [
      'Notes above the table are ignored.',
      '|  Title  | id |Status|  Extra |Mode|',
      '|---|:--:|---|---|---|',
      '|  Hello   |  T-004 | ready | junk | team |',
    ].join('\n')
    const { rows, skipped } = parseBoard(text)
    expect(skipped).toEqual(['Notes above the table are ignored.'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'T-004', title: 'Hello', status: 'Ready', mode: 'Team', verification: 'Pending', integration: 'Pending' })
  })

  it('reports bad rows instead of throwing', () => {
    const text = '| ID | Title | Status |\n| --- | --- | --- |\n| nope | x | Draft |\n| T-001 | ok | Weird |\n| T-002 | fine | Draft |\n| T-002 | dup | Draft |'
    const { rows, skipped } = parseBoard(text)
    expect(rows.map((r) => r.id)).toEqual(['T-002'])
    expect(skipped).toHaveLength(3)
    expect(() => parseBoard(undefined as unknown as string)).not.toThrow()
  })

  it('reports text outside the table instead of dropping it', () => {
    const { rows, skipped } = parseBoard('# Board\n\n| ID | Title | Status |\n| --- | --- | --- |\n| T-001 | a | Draft |\n\nA hand note\n')
    expect(rows).toHaveLength(1)
    expect(skipped).toEqual(['# Board', 'A hand note'])
  })

  it('treats a blank or unknown value in a present enum column as unreadable', () => {
    const head = '| ID | Title | Status | Mode | Verification | Integration |\n| --- | --- | --- | --- | --- | --- |\n'
    for (const bad of ['| T-001 | a |  | Solo | Pending | Pending |', '| T-001 | a | Draft |  | Pending | Pending |', '| T-001 | a | Draft | Solo |  | Pending |', '| T-001 | a | Draft | Solo | Pending | Maybe |']) {
      const { rows, skipped } = parseBoard(head + bad)
      expect(rows).toEqual([])
      expect(skipped).toEqual([bad])
    }
  })

  it('reports a short row with a missing enum cell, and a stray pipe line before the header', () => {
    const text = '| id of the thing |\n| ID | Title | Status | Mode |\n| --- | --- | --- | --- |\n| T-001 | a | Draft |'
    const { rows, skipped } = parseBoard(text)
    expect(rows).toEqual([])
    expect(skipped).toEqual(['| id of the thing |', '| T-001 | a | Draft |'])
  })

  it('parses dependency lists with reasons', () => {
    const text = '| ID | Title | Status | Depends on |\n| --- | --- | --- | --- |\n| T-003 | x | Draft | T-001: store first; T-002 |\n| T-004 | y | Draft | T-001, T-002 |'
    const { rows } = parseBoard(text)
    expect(rows[0]!.dependsOn).toEqual([{ id: 'T-001', reason: 'store first' }, { id: 'T-002', reason: '' }])
    expect(rows[1]!.dependsOn.map((d) => d.id)).toEqual(['T-001', 'T-002'])
  })
})

describe('createTicket', () => {
  it('numbers T-001, T-002 and writes both files and the board', () => {
    expect(make('One').id).toBe('T-001')
    expect(make('Two', { dependsOn: [{ id: 'T-001', reason: 'base' }], mode: 'Team' }).id).toBe('T-002')
    expect(readFileSync(join(ticketsDir(folder), 'T-002', 'rd.md'), 'utf8')).toBe('# rd')
    expect(readFileSync(join(ticketsDir(folder), 'T-002', 'eval.md'), 'utf8')).toBe('- it works')
    const list = listTickets(folder)
    expect(list.tickets.map((t) => [t.id, t.status, t.hasRd, t.hasEval])).toEqual([
      ['T-001', 'Draft', true, true],
      ['T-002', 'Draft', true, true],
    ])
    expect(list.tickets[1]!.dependsOn).toEqual([{ id: 'T-001', reason: 'base' }])
  })

  it('refuses empty eval and leaves nothing behind', () => {
    expect(() => make('x', { eval: '  \n' })).toThrow(/acceptance/)
    expect(existsSync(ticketsDir(folder))).toBe(false)
  })

  it('refuses unknown and cyclic-looking dependencies and cleans up', () => {
    make('One')
    expect(() => make('Two', { dependsOn: [{ id: 'T-009', reason: '' }] })).toThrow(/unknown/)
    expect(readdirSync(ticketsDir(folder)).sort()).toEqual(['T-001', 'board.md'])
    expect(listTickets(folder).tickets).toHaveLength(1)
  })

  it('does not reuse the id of a folder that has no board row', () => {
    mkdirSync(join(ticketsDir(folder), 'T-005'), { recursive: true })
    expect(make('x').id).toBe('T-006')
  })

  it('refuses to write over a board with unreadable lines', () => {
    make('One')
    const board = join(ticketsDir(folder), 'board.md')
    writeFileSync(board, `${readFileSync(board, 'utf8')}| bad | row |\n`)
    expect(() => make('Two')).toThrow(/cannot be read/)
  })
})

describe('setStatus', () => {
  it('follows legal transitions and refuses illegal ones', () => {
    const { id } = make()
    expect(() => setStatus(folder, id, 'Done')).toThrow(/cannot go/)
    expect(setStatus(folder, id, 'Ready').status).toBe('Ready')
    expect(() => setStatus(folder, id, 'Review')).toThrow(/cannot go/)
    setStatus(folder, id, 'In Progress')
    setStatus(folder, id, 'Review')
    expect(listTickets(folder).tickets[0]!.status).toBe('Review')
  })

  it('gates Done on verification and integration', () => {
    const { id } = make()
    for (const s of ['Ready', 'In Progress', 'Review'] as const) setStatus(folder, id, s)
    expect(() => setStatus(folder, id, 'Done')).toThrow(/Passed/)
    updateTicket(folder, id, { verification: 'Passed' })
    expect(() => setStatus(folder, id, 'Done')).toThrow(/Merged/)
    updateTicket(folder, id, { integration: 'Not needed' })
    expect(setStatus(folder, id, 'Done').status).toBe('Done')
    expect(() => setStatus(folder, id, 'Ready')).toThrow(/cannot go/)
  })
})

describe('dependencies', () => {
  it('detectCycle finds a loop and returns null for a DAG', () => {
    expect(detectCycle([row('T-001', ['T-002']), row('T-002', ['T-001'])])).toEqual(['T-001', 'T-002', 'T-001'])
    expect(detectCycle([row('T-001'), row('T-002', ['T-001']), row('T-003', ['T-001', 'T-002'])])).toBeNull()
  })

  it('updateTicket refuses self, unknown and cyclic dependencies', () => {
    make('One')
    make('Two', { dependsOn: [{ id: 'T-001', reason: '' }] })
    expect(() => updateTicket(folder, 'T-001', { dependsOn: [{ id: 'T-001', reason: '' }] })).toThrow(/itself/)
    expect(() => updateTicket(folder, 'T-001', { dependsOn: [{ id: 'T-099', reason: '' }] })).toThrow(/unknown/)
    expect(() => updateTicket(folder, 'T-001', { dependsOn: [{ id: 'T-002', reason: '' }] })).toThrow(/cycle/)
    expect(listTickets(folder).tickets[0]!.dependsOn).toEqual([])
  })

  it('updateTicket changes board fields', () => {
    make('One')
    const r = updateTicket(folder, 'T-001', { title: ' New ', worker: 'w', branch: 'b', worktree: 'wt', mode: 'Team' })
    expect(r).toMatchObject({ title: 'New', worker: 'w', branch: 'b', worktree: 'wt', mode: 'Team' })
  })
})

describe('writes after a hand edit', () => {
  it('refuse to rewrite a board that has stray text or a blanked status', () => {
    make('One')
    setStatus(folder, 'T-001', 'Ready')
    const board = join(ticketsDir(folder), 'board.md')
    const good = readFileSync(board, 'utf8')
    writeFileSync(board, `a note\n${good}`)
    expect(() => make('Two')).toThrow(/board\.md has 1 line.*Fix or delete.*retry/)
    expect(() => make('Two')).toThrow(board)
    expect(readFileSync(board, 'utf8')).toBe(`a note\n${good}`)
    writeFileSync(board, good.replace('Ready', ''))
    expect(() => setStatus(folder, 'T-001', 'In Progress')).toThrow(/cannot be read/)
  })
})

describe('lock', () => {
  const lockFile = () => join(ticketsDir(folder), '.lock')

  it('waits for a lock held by another process, then both updates land', async () => {
    make('One')
    make('Two')
    // The child holds the lock for 600ms and, while holding it, changes T-002 on the board by hand.
    const script = `
      const fs = require('fs'); const path = ${JSON.stringify(lockFile())}; const board = ${JSON.stringify(join(ticketsDir(folder), 'board.md'))};
      fs.writeFileSync(path, '', { flag: 'wx' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
      fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('| T-002 | Two | Draft', '| T-002 | Two | Ready'));
      fs.unlinkSync(path);`
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
    const done = new Promise((r) => child.on('exit', r))
    await waitFor(() => existsSync(lockFile()), 'the child to take the lock')
    const t0 = Date.now()
    setStatus(folder, 'T-001', 'Ready') // blocks until the child releases, then reads the child's edit
    expect(Date.now() - t0).toBeGreaterThan(300)
    await done
    expect(listTickets(folder).tickets.map((t) => t.status)).toEqual(['Ready', 'Ready'])
    expect(existsSync(lockFile())).toBe(false)
  })

  it('clears a stale lock', () => {
    make('One')
    writeFileSync(lockFile(), '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockFile(), old, old)
    expect(setStatus(folder, 'T-001', 'Ready').status).toBe('Ready')
    expect(existsSync(lockFile())).toBe(false)
    expect(readdirSync(ticketsDir(folder)).filter((n) => n.includes('.stale-'))).toEqual([])
  })

  it('gives up with a clear error when a fresh lock never frees', () => {
    make('One')
    writeFileSync(lockFile(), '')
    expect(() => setStatus(folder, 'T-001', 'Ready')).toThrow(/locked/)
    expect(listTickets(folder).tickets[0]!.status).toBe('Draft')
  }, 10_000)

  it('releases the lock when the work throws', () => {
    make('One')
    expect(() => setStatus(folder, 'T-001', 'Done')).toThrow()
    expect(existsSync(lockFile())).toBe(false)
  })
})

describe('paths and atomic writes', () => {
  it('refuses ids that could leave the tickets folder', () => {
    make()
    for (const id of ['..', '../x', 'T-001/..', 'T-001\\..', '', 'T-1', '..\\..\\etc']) {
      expect(() => getTicket(folder, id)).toThrow(/Invalid ticket id/)
      expect(() => setStatus(folder, id, 'Ready')).toThrow(/Invalid ticket id/)
      expect(() => updateTicket(folder, id, { title: 'x' })).toThrow(/Invalid ticket id/)
    }
  })

  it('leaves no temp file after writes', () => {
    make('One')
    make('Two')
    setStatus(folder, 'T-001', 'Ready')
    expect(readdirSync(ticketsDir(folder)).filter((n) => n.includes('.tmp'))).toEqual([])
    expect(readdirSync(join(ticketsDir(folder), 'T-001')).sort()).toEqual(['eval.md', 'log.md', 'notes.md', 'rd.md'])
  })

  it('getTicket returns rd and eval text', () => {
    make('One')
    const d = getTicket(folder, 'T-001')
    expect(d.rd).toBe('# rd')
    expect(d.eval).toBe('- it works')
    expect(d.ticket.id).toBe('T-001')
    expect(() => getTicket(folder, 'T-002')).toThrow(/Unknown/)
  })

  it('listTickets on a folder with no tickets is empty', () => {
    expect(listTickets(folder)).toEqual({ tickets: [], skipped: [] })
  })
})

const logOf = (id: string) => readFileSync(join(ticketsDir(folder), id, 'log.md'), 'utf8').trim().split(/\r?\n/)
const ready = (id: string) => setStatus(folder, id, 'Ready')

describe('claim and release', () => {
  it('claims a Ready ticket whose dependencies are Done', () => {
    make('One')
    make('Two', { dependsOn: [{ id: 'T-001', reason: '' }] })
    ready('T-001')
    ready('T-002')
    expect(() => claimTicket(folder, 'T-002', 'w1')).toThrow(/waiting on T-001/)
    updateTicket(folder, 'T-001', { verification: 'Passed', integration: 'Not needed' })
    setStatus(folder, 'T-001', 'In Progress')
    setStatus(folder, 'T-001', 'Review')
    setStatus(folder, 'T-001', 'Done')
    const got = claimTicket(folder, 'T-002', 'w1')
    expect(got.status).toBe('In Progress')
    expect(got.worker).toBe('w1')
    expect(getTicket(folder, 'T-002').ticket.worker).toBe('w1')
  })

  it('refuses a ticket that is not Ready, and a second claim', () => {
    make('One')
    expect(() => claimTicket(folder, 'T-001', 'w1')).toThrow(/only a Ready ticket/)
    ready('T-001')
    claimTicket(folder, 'T-001', 'w1')
    expect(() => claimTicket(folder, 'T-001', 'w2')).toThrow(/already claimed by w1/)
    expect(() => claimTicket(folder, 'T-001', ' ')).toThrow(/worker id/)
    expect(getTicket(folder, 'T-001').ticket.worker).toBe('w1')
  })

  it('refuses a claim when another process took the ticket while holding the lock', async () => {
    make('One')
    ready('T-001')
    const lock = join(ticketsDir(folder), '.lock')
    const board = join(ticketsDir(folder), 'board.md')
    const script = `
      const fs = require('fs'); const path = ${JSON.stringify(lock)}; const board = ${JSON.stringify(board)};
      fs.writeFileSync(path, '', { flag: 'wx' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('| Ready |', '| In Progress |').replace('|  |  |  | Pending', '| other |  |  | Pending'));
      fs.unlinkSync(path);`
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
    const done = new Promise((r) => child.on('exit', r))
    await waitFor(() => existsSync(lock), 'the child to take the lock')
    expect(() => claimTicket(folder, 'T-001', 'mine')).toThrow(/already claimed/)
    await done
    expect(listTickets(folder).tickets[0]?.status).toBe('In Progress')
    expect(listTickets(folder).tickets[0]?.worker).not.toBe('mine')
  })

  it('release puts the ticket back to Ready and clears the worker, only for the holder', () => {
    make('One')
    ready('T-001')
    claimTicket(folder, 'T-001', 'w1')
    expect(() => releaseTicket(folder, 'T-001', 'w2')).toThrow(/held by w1/)
    const r = releaseTicket(folder, 'T-001', 'w1')
    expect(r.status).toBe('Ready')
    expect(r.worker).toBe('')
    expect(() => releaseTicket(folder, 'T-001', 'w1')).toThrow(/only an In Progress/)
  })

  it('release trims the worker id like claim does', () => {
    make('One')
    ready('T-001')
    claimTicket(folder, 'T-001', ' w1 ')
    expect(releaseTicket(folder, 'T-001', '  w1\n').status).toBe('Ready')
  })

  it('reads the Touches line from rd.md, and nothing when it is missing', () => {
    createTicket(folder, { title: 'A', rd: '# rd\nTouches: core/foo.ts,  shared/ , \nmore', eval: '- ok' })
    make('B')
    expect(readTouches(folder, 'T-001')).toEqual(['core/foo.ts', 'shared/'])
    expect(readTouches(folder, 'T-002')).toEqual([])
    expect(readTouches(folder, 'T-003')).toEqual([])
    expect(() => readTouches(folder, '../x')).toThrow(/Invalid ticket id/)
    // An rd.md that cannot be read (here a folder in its place) gives none instead of throwing.
    rmSync(join(ticketsDir(folder), 'T-002', 'rd.md'))
    mkdirSync(join(ticketsDir(folder), 'T-002', 'rd.md'))
    expect(readTouches(folder, 'T-002')).toEqual([])
  })
})

describe('ticket log', () => {
  it('creates an empty notes.md and logs each event with an ISO time', () => {
    make('One')
    expect(readFileSync(join(ticketsDir(folder), 'T-001', 'notes.md'), 'utf8')).toBe('')
    ready('T-001')
    claimTicket(folder, 'T-001', 'w1')
    releaseTicket(folder, 'T-001', 'w1')
    claimTicket(folder, 'T-001', 'w2')
    updateTicket(folder, 'T-001', { verification: 'Passed' })
    recoverTickets(folder, new Set())
    const lines = logOf('T-001')
    for (const l of lines) expect(l).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z /)
    expect(lines.map((l) => l.slice(l.indexOf(' ') + 1))).toEqual([
      'created',
      'status Draft -> Ready',
      'claimed by w1',
      'released by w1',
      'claimed by w2',
      'verification Pending -> Passed',
      'interrupted: worker gone',
    ])
  })
})

describe('recoverTickets', () => {
  it('returns dead In Progress work to Ready, keeps live workers, Review, Done and Failed', () => {
    for (const t of ['A', 'B', 'C', 'D', 'E']) make(t)
    for (const id of ['T-001', 'T-002', 'T-003', 'T-004', 'T-005']) ready(id)
    claimTicket(folder, 'T-001', 'dead')
    claimTicket(folder, 'T-002', 'alive')
    claimTicket(folder, 'T-003', 'dead')
    claimTicket(folder, 'T-004', 'dead')
    setStatus(folder, 'T-003', 'Review')
    setStatus(folder, 'T-004', 'Failed')
    expect(recoverTickets(folder, new Set(['alive']))).toEqual(['T-001'])
    const by = Object.fromEntries(listTickets(folder).tickets.map((t) => [t.id, t]))
    expect(by['T-001']).toMatchObject({ status: 'Ready', worker: '' })
    expect(by['T-002']).toMatchObject({ status: 'In Progress', worker: 'alive' })
    expect(by['T-003']).toMatchObject({ status: 'Review', worker: 'dead' })
    expect(by['T-004']?.status).toBe('Failed')
    expect(by['T-005']?.status).toBe('Ready')
    expect(logOf('T-001').at(-1)).toMatch(/interrupted: worker gone$/)
    expect(recoverTickets(folder, new Set(['alive']))).toEqual([])
  })

  it('does nothing when there is no board', () => {
    expect(recoverTickets(folder, new Set())).toEqual([])
    expect(existsSync(ticketsDir(folder))).toBe(false)
  })
})

describe('eval.md criteria', () => {
  const evalPath = (id: string) => join(ticketsDir(folder), id, 'eval.md')

  it('reads a checklist and ignores other lines', () => {
    make('A', { eval: '# Done when\n- [ ] one\n* [x] two\nprose\n  - [X]  three  \n- [] not a box' })
    const c = readCriteria(folder, 'T-001')
    expect(c.total).toBe(3)
    expect(c.met).toBe(2)
    expect(c.items.map((i) => [i.index, i.text, i.met])).toEqual([[1, 'one', false], [2, 'two', true], [3, 'three', true]])
  })

  it('accepts every list marker form and keeps the marker, indent and spacing when marking', () => {
    make('A', { eval: ['+ [ ] plus', '1. [ ] dot', '2) [x] paren', '   - [ ] three spaces', '* [X]  wide'].join('\n') })
    const c = readCriteria(folder, 'T-001')
    expect(c.problems).toEqual([])
    expect(c.items.map((i) => [i.text, i.met])).toEqual([['plus', false], ['dot', false], ['paren', true], ['three spaces', false], ['wide', true]])
    markCriterion(folder, 'T-001', 1, true, 'e')
    markCriterion(folder, 'T-001', 4, true, 'e')
    expect(readFileSync(evalPath('T-001'), 'utf8')).toBe(['+ [x] plus', '1. [ ] dot', '2) [x] paren', '   - [x] three spaces', '* [X]  wide'].join('\n'))
    expect(readCriteria(folder, 'T-001').met).toBe(4)
  })

  it('counts a criterion on line 1 after a BOM, and keeps the BOM when marking', () => {
    const bom = String.fromCharCode(0xfeff)
    make('A', { eval: `${bom}- [ ] first\r\n- [ ] second\r\n` })
    expect(readCriteria(folder, 'T-001')).toMatchObject({ total: 2, met: 0, problems: [] })
    markCriterion(folder, 'T-001', 1, true, 'e')
    expect(readFileSync(evalPath('T-001'), 'utf8')).toBe(`${bom}- [x] first\r\n- [ ] second\r\n`)
  })

  it('does not track markdown: a comment holding a fence marker cannot hide an unmet criterion', () => {
    make('A', { eval: ['- [x] one', '<!-- ``` -->', '- [ ] unmet', '```', 'a stray fence line is just text'].join('\n') })
    const c = readCriteria(folder, 'T-001')
    expect(c.problems).toEqual([])
    expect(c.items.map((i) => [i.text, i.met])).toEqual([['one', true], ['unmet', false]])
    expect(() => setVerification(folder, 'T-001', 'Passed')).toThrow(/1 of 2 criteria not met \(2\)/)
  })

  it('treats every other box token as a problem, wherever it is', () => {
    const nbsp = String.fromCharCode(0xa0)
    const cases: Record<string, string> = {
      'fenced code': ['- [x] real', '```', 'let a = [ ]', '```'].join('\n'),
      blockquote: '- [x] real\n> - [ ] quoted',
      nested: '- [x] real\n- > - [ ] x',
      'quote then box': '- [x] real\n> [ ] x',
      table: '- [x] real\n| a | [ ] |',
      'no space after marker': '- [x] real\n-[ ] x',
      'no text': '- [x] real\n- [ ]',
      'nbsp inside brackets': `- [x] real\n- [${nbsp}] x`,
      'nbsp after marker': `- [x] real\n-${nbsp}[ ] x`,
      ballot: '- [x] real\n☐ not a criterion',
      'ballot after marker': '- [x] real\n- ☑ done',
      'second box in text': '- [x] real [ ] again',
      comment: '- [x] real\n<!-- [ ] hidden -->',
    }
    for (const [name, text] of Object.entries(cases)) {
      const f = mkdtempSync(join(tmpdir(), 'foreman-tickets-'))
      try {
        createTicket(f, { title: name, rd: '', eval: text })
        const c = readCriteria(f, 'T-001')
        expect(c.problems, name).toHaveLength(1)
        expect(c.problems[0], name).toMatch(/^eval\.md line \d+: unexpected checkbox in ".*"; write criteria as "- \[ \] text" lines; remove other \[ \] tokens from eval\.md$/)
        expect(() => setVerification(f, 'T-001', 'Passed'), name).toThrow(/unexpected checkbox/)
        expect(() => markCriterion(f, 'T-001', 1, true, 'e'), name).toThrow(/unexpected checkbox/)
        expect(markCriterion(f, 'T-001', 1, false, 'e').met, name).toBe(false) // unmet still works
      } finally {
        rmSync(f, { recursive: true, force: true })
      }
    }
  })

  it('names the line and shows the text of the stray box', () => {
    make('A', { eval: ['- [x] real', '', 'see > [ ] here'].join('\n') })
    expect(readCriteria(folder, 'T-001').problems).toEqual([expect.stringContaining('line 3: unexpected checkbox in "see > [ ] here"')])
  })

  it('setVerification refuses Passed with no criteria or unmet ones, and accepts it when all are met', () => {
    make('A', { eval: 'prose only' })
    expect(() => setVerification(folder, 'T-001', 'Passed')).toThrow(/no "- \[ \] criterion" lines/)
    make('B', { eval: '- [ ] one\n- [ ] two' })
    expect(() => setVerification(folder, 'T-002', 'Passed')).toThrow(/2 of 2 criteria not met \(1, 2\)/)
    markCriterion(folder, 'T-002', 1, true, 'e')
    markCriterion(folder, 'T-002', 2, true, 'e')
    expect(setVerification(folder, 'T-002', 'Passed').verification).toBe('Passed')
    expect(setVerification(folder, 'T-002', 'Pending').verification).toBe('Pending')
  })

  it('never throws on a missing file, an unknown ticket or a CRLF file', () => {
    expect(readCriteria(folder, 'T-009')).toEqual({ total: 0, met: 0, items: [], problems: [] })
    make('A', { eval: '- [ ] one\r\n- [ ] two\r\n' })
    expect(readCriteria(folder, 'T-001').total).toBe(2)
    rmSync(evalPath('T-001'))
    expect(readCriteria(folder, 'T-001').total).toBe(0)
  })

  it('marks and unmarks one criterion, keeps the rest of the file, and logs the evidence', () => {
    make('A', { eval: '# Title\r\n- [ ] one\r\n- [ ] two\r\nend' })
    expect(markCriterion(folder, 'T-001', 2, true, '  saw it work  ', 'council')).toEqual({ index: 2, text: 'two', met: true })
    expect(readFileSync(evalPath('T-001'), 'utf8')).toBe('# Title\r\n- [ ] one\r\n- [x] two\r\nend')
    markCriterion(folder, 'T-001', 2, false, 'regressed')
    expect(readCriteria(folder, 'T-001').met).toBe(0)
    const log = readFileSync(join(ticketsDir(folder), 'T-001', 'log.md'), 'utf8')
    expect(log).toContain('criterion 2 met by council: saw it work')
    expect(log).toContain('criterion 2 unmet: regressed')
  })

  it('refuses an out-of-range index, empty evidence and an unknown ticket', () => {
    make('A', { eval: '- [ ] one' })
    for (const i of [0, 2, -1, 1.5, NaN]) expect(() => markCriterion(folder, 'T-001', i, true, 'e')).toThrow(/out of range/)
    expect(() => markCriterion(folder, 'T-001', 1, true, '  ')).toThrow(/evidence/)
    expect(() => markCriterion(folder, 'T-009', 1, true, 'e')).toThrow(/Unknown ticket/)
    expect(readCriteria(folder, 'T-001').met).toBe(0)
  })
})

describe('handoffTicket', () => {
  it('changes the worker of an In Progress ticket only from the named worker', () => {
    const t = make()
    expect(() => handoffTicket(folder, t.id, 'w1', 'repro')).toThrow(/only an In Progress/)
    setStatus(folder, t.id, 'Ready')
    claimTicket(folder, t.id, 'w1')
    expect(() => handoffTicket(folder, t.id, 'w2', 'repro')).toThrow(/held by w1, not w2/)
    expect(() => handoffTicket(folder, t.id, 'w1', ' ')).toThrow(/from and a to/)
    expect(handoffTicket(folder, t.id, 'w1', 'repro').worker).toBe('repro')
    expect(getTicket(folder, t.id).ticket.worker).toBe('repro')
    expect(readFileSync(join(ticketsDir(folder), t.id, 'log.md'), 'utf8')).toContain('handed off from w1 to repro')
  })
})
