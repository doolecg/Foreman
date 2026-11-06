import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listTickets } from './tickets'
import { Foreman, type CliAccess, type Scheduler } from './foreman'
import { SessionManager, type Pty, type PtyFactory } from './sessions'
import { Store } from './store'

class FakePty implements Pty {
  write() {}
  resize() {}
  kill() {}
  onData() {}
  onExit() {}
}

const cli: CliAccess = { address: '/tmp/op.sock', issueToken: (id) => `t${id}`, revokeToken: () => undefined, listen: async () => '/tmp/op.sock', close: async () => undefined }
const scheduler: Scheduler = { every: () => ({}), cancel: () => undefined }

describe('Foreman: ticket board writes', () => {
  let store: Store
  let op: Foreman
  let root: string
  let folder: string
  let crewId: number
  const board = () => join(folder, '.foreman', 'tickets', 'board.md')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'foreman-tickets-'))
    folder = join(root, 'shop')
    mkdirSync(folder, { recursive: true })
    store = new Store(':memory:')
    const spawn: PtyFactory = () => new FakePty()
    op = new Foreman({
      store,
      sessions: new SessionManager(spawn),
      pluginDir: '/plugin',
      transcriptFile: (_cwd, id) => join(root, `${id}.jsonl`),
      cliServer: () => cli,
      scheduler,
      now: () => Date.now(),
    })
    crewId = store.createCrew('shop', folder).id
  })
  afterEach(() => {
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  const create = (title = 'First') => op.handlers['tickets:create'](crewId, { title, rd: 'why', eval: '- [ ] works' })

  it('create adds a Draft row to the board', () => {
    const r = create()
    expect(r).toMatchObject({ ok: true, ticket: { id: 'T-001', title: 'First', status: 'Draft' } })
    expect(listTickets(folder).tickets.map((t) => t.id)).toEqual(['T-001'])
  })

  it('a legal move works', () => {
    create()
    const r = op.handlers['tickets:setStatus'](crewId, 'T-001', 'Ready')
    expect(r).toMatchObject({ ok: true, ticket: { id: 'T-001', status: 'Ready' } })
    expect(listTickets(folder).tickets[0]!.status).toBe('Ready')
  })

  it('an illegal move returns the error and leaves board.md unchanged', () => {
    create()
    const before = readFileSync(board(), 'utf8')
    const r = op.handlers['tickets:setStatus'](crewId, 'T-001', 'Done')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('T-001: Draft cannot go to Done') })
    expect(readFileSync(board(), 'utf8')).toBe(before)
  })

  it('a write is refused while the board has unreadable lines, with the store message', () => {
    create()
    writeFileSync(board(), readFileSync(board(), 'utf8') + '\nthis line is not a ticket\n')
    const before = readFileSync(board(), 'utf8')
    const moved = op.handlers['tickets:setStatus'](crewId, 'T-001', 'Ready')
    expect(moved).toEqual({ ok: false, error: expect.stringContaining('cannot be read') })
    expect(create('Second')).toEqual({ ok: false, error: expect.stringContaining('cannot be read') })
    expect(readFileSync(board(), 'utf8')).toBe(before)
  })

  it('an unknown project returns an error', () => {
    expect(op.handlers['tickets:setStatus'](9999, 'T-001', 'Ready')).toEqual({ ok: false, error: expect.any(String) })
  })
})
