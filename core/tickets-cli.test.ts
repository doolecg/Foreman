import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs build script
import { buildTicketsCli } from '../scripts/build-tickets-cli.mjs'

let root: string
let cli: string
let project: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'fm-tickets-cli-'))
  project = join(root, 'project')
  cli = await buildTicketsCli(join(root, 'cli'))
}, 120_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

function runIn(folder: string, args: string[], input?: unknown) {
  const r = spawnSync(process.execPath, [cli, '--project', folder, ...args], { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input) })
  return { code: r.status, out: r.stdout, err: r.stderr, json: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null }
}
const run = (args: string[], input?: unknown) => runIn(project, args, input)

// Each test spawns several node processes, so the 5s default is too tight under the full parallel suite.
describe('tickets.mjs', { timeout: 60_000 }, () => {
  it('runs the whole worker flow as a child process', () => {
    expect(existsSync(cli)).toBe(true)
    const a = run(['create'], { title: 'First', rd: 'do first', eval: '- [ ] first works', touches: ['core/a.ts'] })
    const b = run(['create'], { title: 'Second', rd: 'do second', eval: '- [ ] second works', dependsOn: ['T-001'] })
    expect([a.json.id, b.json.id]).toEqual(['T-001', 'T-002'])
    expect(readFileSync(join(project, '.foreman/tickets/T-001/rd.md'), 'utf8')).toContain('Touches: core/a.ts')

    expect(run(['claim', 'T-001', 'w1']).code).toBe(1) // still Draft
    expect(run(['status', 'T-001', 'Ready']).code).toBe(0)
    expect(run(['status', 'T-002', 'Ready']).code).toBe(0)
    expect(run(['next']).json.start).toEqual(['T-001'])
    expect(run(['next', '--max', '1']).json.waiting).toEqual([{ id: 'T-002', reason: 'waiting on T-001 (Ready)' }])

    expect(run(['claim', 'T-001', 'w1']).json.worker).toBe('w1')
    const again = run(['claim', 'T-001', 'w2'])
    expect(again.code).toBe(1)
    expect(again.err).toMatch(/^error: T-001 is already claimed by w1\r?\n$/)

    expect(run(['log', 'T-001', 'did   a thing']).code).toBe(0)
    expect(readFileSync(join(project, '.foreman/tickets/T-001/log.md'), 'utf8')).toContain('did a thing')
    expect(run(['set', 'T-001', 'branch', 'feat/one']).err).toMatch(/only foreman\/T-001 is allowed/)
    expect(run(['set', 'T-001', 'branch', 'main']).code).toBe(1)
    expect(run(['set', 'T-001', 'worktree', project]).err).toMatch(/is allowed for T-001/)
    expect(run(['set', 'T-001', 'branch', 'foreman/T-001']).json.branch).toBe('foreman/T-001')
    expect(run(['status', 'T-001', 'Review']).json.status).toBe('Review')

    const done = run(['status', 'T-001', 'Done', '--as', 'router'])
    expect(done.code).toBe(1)
    expect(done.err).toMatch(/verification is Passed/)
    expect(run(['show', 'T-001']).json.ticket.status).toBe('Review')
    expect(run(['list']).json.tickets).toHaveLength(2)

    expect(run(['set', 'T-001', 'verification', 'Passed', '--evidence', 'x', '--as', 'reviewer']).err).toMatch(/1 of 1 criteria not met/)
    expect(run(['criterion', 'T-001', '1', 'met', '--evidence', 'test passes', '--as', 'reviewer']).code).toBe(0)
    expect(run(['set', 'T-001', 'verification', 'Passed', '--evidence', 'all met', '--as', 'reviewer']).code).toBe(0)
    expect(run(['status', 'T-001', 'Done']).err).toMatch(/needs --as/) // no actor, refused before the Done gate
    expect(run(['set', 'T-001', 'integration', 'Merged']).err).toMatch(/needs --as merger\|router/)
    expect(run(['set', 'T-001', 'integration', 'Merged', '--as', 'reviewer']).err).toMatch(/needs --as merger\|router/)
    expect(run(['set', 'T-001', 'integration', 'Merged', '--as', 'merger']).code).toBe(0)
    expect(run(['status', 'T-001', 'Done', '--as', 'router']).json.status).toBe('Done')
    expect(run(['next']).json.start).toEqual(['T-002'])
  })

  it('keeps approvals away from the worker', () => {
    run(['create'], { title: 'Third', eval: '- [ ] ok' })
    run(['status', 'T-003', 'Ready'])
    run(['claim', 'T-003', 'reviewer'])
    const refused = (args: string[], re: RegExp) => {
      const r = run(args)
      expect(r.code, args.join(' ')).toBe(1)
      expect(r.err).toMatch(re)
    }
    refused(['set', 'T-003', 'verification', 'Passed'], /needs --as/)
    refused(['set', 'T-003', 'verification', 'Passed', '--as', 'builder'], /needs --as/)
    refused(['set', 'T-003', 'integration', 'Not needed'], /needs --as/)
    refused(['set', 'T-003', 'verification', 'Passed', '--as', 'reviewer'], /cannot approve its own work/)
    refused(['status', 'T-003', 'Failed'], /needs --as/)
    refused(['set', 'T-003', 'verification', 'Failed'], /needs --as/)
    refused(['set', 'T-003', 'verification', 'Passed', '--as', 'merger'], /needs --as reviewer\|council/)
    refused(['set', 'T-003', 'integration', 'Failed'], /needs --as/)
    refused(['set', 'T-003', 'verification', 'Passed', '--as', 'council'], /needs --evidence/)
    refused(['set', 'T-003', 'verification', 'Passed', '--evidence', '  ', '--as', 'council'], /needs --evidence/)
    refused(['set', 'T-003', 'verification', 'Failed', '--as', 'council'], /needs --evidence/)
    refused(['set', 'T-003', 'verification', 'Passed', '--evidence', 'looks fine', '--as', 'council'], /1 of 1 criteria not met/)
    refused(['criterion', 'T-003', '1', 'met', '--as', 'council'], /needs --evidence/)
    refused(['criterion', 'T-003', '1', 'met', '--evidence', 'e'], /needs --as/)
    refused(['criterion', 'T-003', '1', 'met', '--evidence', 'e', '--as', 'reviewer'], /cannot approve its own work/)
    refused(['criterion', 'T-003', '2', 'met', '--evidence', 'e', '--as', 'council'], /out of range/)
    refused(['criterion', 'T-003', '1', 'maybe', '--evidence', 'e', '--as', 'council'], /met or unmet/)
    expect(run(['criterion', 'T-003', '1', 'met', '--evidence', 'ran the check', '--as', 'council']).json).toMatchObject({ index: 1, met: true })
    expect(run(['criteria', 'T-003']).json).toMatchObject({ total: 1, met: 1 })
    expect(run(['set', 'T-003', 'verification', 'Passed', '--evidence', 'all met', '--as', 'council']).code).toBe(0)
    const log = readFileSync(join(project, '.foreman/tickets/T-003/log.md'), 'utf8')
    expect(log).toContain('verification Passed approved by council: all met')
    expect(log).toContain('criterion 1 met by council: ran the check')
  })

  it('refuses Passed when eval.md has no criteria', () => {
    run(['create'], { title: 'Plain', eval: 'just prose, no checklist' })
    expect(run(['set', 'T-004', 'verification', 'Passed', '--evidence', 'x', '--as', 'council']).err).toMatch(/no "- \[ \] criterion" lines/)
  })

  it('hands a running ticket to another worker, router only', () => {
    run(['create'], { title: 'Fix', eval: '- [ ] fixed' })
    const id = 'T-005'
    const refused = (args: string[], re: RegExp) => {
      const r = run(args)
      expect(r.code, args.join(' ')).toBe(1)
      expect(r.err).toMatch(re)
    }
    refused(['handoff', id, 'w1', 'repro', '--as', 'router'], /only an In Progress ticket/)
    run(['status', id, 'Ready'])
    run(['claim', id, 'w1'])
    refused(['handoff', id, 'w1', 'repro'], /needs --as router/)
    refused(['handoff', id, 'w1', 'repro', '--as', 'reviewer'], /needs --as router/)
    refused(['handoff', id, 'w9', 'repro', '--as', 'router'], /held by w1, not w9/)
    expect(run(['handoff', id, 'w1', 'repro', '--as', 'router']).json.worker).toBe('repro')
    refused(['handoff', id, 'w1', 'other', '--as', 'router'], /held by repro/)
    expect(readFileSync(join(project, '.foreman/tickets/T-005/log.md'), 'utf8')).toContain('handed off from w1 to repro')
  })

  it('refuses Passed and criterion met when eval.md has a stray checkbox or a blockquoted one', () => {
    run(['create'], { title: 'Fence', eval: ['- [ ] one', '```', 'let a = [ ]', '```'].join('\n') })
    run(['create'], { title: 'Quote', eval: '- [ ] one\n> - [ ] quoted' })
    const fence = run(['criterion', 'T-006', '1', 'met', '--evidence', 'e', '--as', 'council'])
    expect(fence.err).toMatch(/^error: eval\.md line 3: unexpected checkbox/)
    expect(run(['set', 'T-006', 'verification', 'Passed', '--evidence', 'e', '--as', 'council']).err).toMatch(/unexpected checkbox/)
    expect(run(['criteria', 'T-006']).json.problems).toHaveLength(1)
    expect(run(['criterion', 'T-007', '1', 'met', '--evidence', 'e', '--as', 'council']).err).toMatch(/line 2: unexpected checkbox/)
    expect(run(['set', 'T-007', 'verification', 'Passed', '--evidence', 'e', '--as', 'council']).err).toMatch(/unexpected checkbox/)
  })

  it('logs text that contains "--"', () => {
    expect(run(['log', 'T-002', 'a', '--', 'b']).json.logged).toBe('a -- b')
  })

  it('is the committed bundle', () => {
    const norm = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    expect(norm(cli) === norm(resolve(__dirname, '..', 'plugin', 'kit', 'foreman', 'tickets.mjs')), 'plugin/kit/foreman/tickets.mjs is out of date: run npm run build').toBe(true)
  })

  it('refuses unknown commands and fields, and writes only inside .foreman/tickets', () => {
    expect(run(['bogus']).code).toBe(1)
    expect(run(['set', 'T-002', 'status', 'Done']).code).toBe(1)
    expect(run(['show', '../x']).code).toBe(1)
    expect(readdirSync(project)).toEqual(['.foreman'])
    expect(readdirSync(join(project, '.foreman'))).toEqual(['tickets'])
  })

  it('test-lock runs the command and passes its exit code on', () => {
    const ok = run(['test-lock', '--', 'node', '-e', 'console.log(String(7*6))'])
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('42')
    expect(existsSync(join(project, '.foreman/tickets/.testlock'))).toBe(false)
    if (process.platform === 'win32') {
      const inj = run(['test-lock', '--', 'node', '-e', 'a" & calc & "b'])
      expect(inj.code).toBe(1)
      expect(inj.err).toMatch(/cannot take an argument containing/)
    }
    const bad = run(['test-lock', '--', 'node', '-e', 'process.exit(3)'])
    expect(bad.code).toBe(3)
    expect(existsSync(join(project, '.foreman/tickets/.testlock'))).toBe(false)
  })

  it('test-lock passes an argument that ends in a backslash through unchanged', () => {
    const arg = process.platform === 'win32' ? 'C:\\some dir\\' : '/some dir/\\'
    const r = run(['test-lock', '--', 'node', '-e', 'process.stdout.write(process.argv[1])', arg])
    expect(r.code).toBe(0)
    expect(r.out).toBe(arg)
  })
})

describe('tickets.mjs worktrees and merge', { timeout: 60_000 }, () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let repo: string
  let wt: string
  const go = (args: string[], input?: unknown) => runIn(repo, ['--worktree-root', wt, ...args], input)
  // Marks criterion 1 met, then passes verification with evidence.
  const pass = (id: string, as: string) => {
    go(['criterion', id, '1', 'met', '--evidence', 'checked', '--as', as])
    return go(['set', id, 'verification', 'Passed', '--evidence', 'all met', '--as', as])
  }

  // Ticket T-001 claimed by w1, with a worktree holding one commit that adds b.txt.
  function startTicket(): string {
    go(['create'], { title: 'Add b', eval: '- [ ] b exists' })
    go(['status', 'T-001', 'Ready'])
    go(['claim', 'T-001', 'w1'])
    const made = go(['worktree', 'create', 'T-001'])
    writeFileSync(join(made.json.worktree, 'b.txt'), 'new\n')
    git(made.json.worktree, 'add', '-A')
    git(made.json.worktree, 'commit', '-m', 'work')
    return made.json.worktree
  }

  beforeEach(() => {
    repo = join(root, `git-${Math.random().toString(36).slice(2)}`)
    wt = join(root, `wt-${Math.random().toString(36).slice(2)}`)
    mkdirSync(repo)
    git(repo, 'init', '-b', 'dev-x')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-m', 'start')
  })

  it('creates the worktree for a claimed ticket and records branch and worktree', () => {
    const early = go(['worktree', 'create', 'T-001'])
    expect(early.code).toBe(1) // no such ticket yet
    go(['create'], { title: 'Add b', eval: '- [ ] b exists' })
    expect(go(['worktree', 'create', 'T-001']).err).toMatch(/must be In Progress and claimed/)
    go(['status', 'T-001', 'Ready'])
    go(['claim', 'T-001', 'w1'])
    const made = go(['worktree', 'create', 'T-001'])
    expect(made.json).toMatchObject({ isolation: 'worktree', branch: 'foreman/T-001' })
    expect(existsSync(join(made.json.worktree, 'a.txt'))).toBe(true)
    const row = go(['show', 'T-001']).json.ticket
    expect(row.branch).toBe('foreman/T-001')
    expect(row.worktree).toBe(made.json.worktree)
    expect(go(['worktree', 'create', 'T-001']).code).toBe(1) // already there
  })

  it('works in place when the folder is not a git repo', () => {
    const plain = join(root, `plain-${Math.random().toString(36).slice(2)}`)
    mkdirSync(plain)
    const at = (args: string[], input?: unknown) => runIn(plain, ['--worktree-root', wt, ...args], input)
    at(['create'], { title: 'T', eval: 'e' })
    at(['status', 'T-001', 'Ready'])
    at(['claim', 'T-001', 'w1'])
    expect(at(['worktree', 'create', 'T-001']).json).toEqual({ isolation: 'none' })
    const row = at(['show', 'T-001']).json.ticket
    expect([row.branch, row.worktree]).toEqual(['', ''])
    expect(existsSync(wt)).toBe(false)
  })

  it('merges only with --as merger, runs the check, and leaves the ticket Merged', () => {
    const tree = startTicket()
    go(['status', 'T-001', 'Review'])
    expect(go(['merge', 'T-001']).err).toMatch(/needs --as merger/)
    expect(go(['merge', 'T-001', '--as', 'router']).err).toMatch(/needs --as merger/)
    expect(go(['merge', 'T-001', '--as', 'merger']).err).toMatch(/verification is Pending/)
    pass('T-001', 'reviewer')
    const r = go(['merge', 'T-001', '--as', 'merger', '--check', 'node -e process.exit(0)'])
    expect(r.code).toBe(0)
    expect(r.json.outcome).toBe('merged')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(r.json.mergeSha)
    expect(existsSync(tree)).toBe(false)
    expect(go(['show', 'T-001']).json.ticket.integration).toBe('Merged')
    expect(readFileSync(join(repo, '.foreman/tickets/T-001/log.md'), 'utf8')).toContain(r.json.mergeSha)
    expect(go(['status', 'T-001', 'Done', '--as', 'router']).json.status).toBe('Done')
  })

  it('refuses to merge into main', () => {
    startTicket()
    go(['status', 'T-001', 'Review'])
    pass('T-001', 'council')
    git(repo, 'checkout', '-b', 'main')
    expect(go(['merge', 'T-001', '--as', 'merger']).err).toMatch(/main is protected/)
  })

  it('exits 2 with the files on a conflict and 3 after reverting a failed check', () => {
    startTicket()
    go(['status', 'T-001', 'Review'])
    pass('T-001', 'council')
    const bad = go(['merge', 'T-001', '--as', 'merger', '--check', 'node -e process.exit(1)'])
    expect(bad.code).toBe(3)
    expect(bad.json.outcome).toBe('check-failed')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(go(['show', 'T-001']).json.ticket.integration).toBe('Failed')

    go(['create'], { title: 'Edit a', eval: '- [ ] a edited' })
    go(['status', 'T-002', 'Ready'])
    go(['claim', 'T-002', 'w2'])
    const made = go(['worktree', 'create', 'T-002'])
    writeFileSync(join(made.json.worktree, 'a.txt'), 'theirs\n')
    git(made.json.worktree, 'add', '-A')
    git(made.json.worktree, 'commit', '-m', 'theirs')
    writeFileSync(join(repo, 'a.txt'), 'ours\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-m', 'ours')
    const head = git(repo, 'rev-parse', 'HEAD')
    go(['status', 'T-002', 'Review'])
    pass('T-002', 'council')
    const clash = go(['merge', 'T-002', '--as', 'merger'])
    expect(clash.code).toBe(2)
    expect(clash.json.conflict).toEqual(['a.txt'])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'status', '--porcelain', '--untracked-files=no')).toBe('')
    expect(go(['show', 'T-002']).json.ticket.integration).toBe('Failed')
  })

  // The argument has a space, so the whitespace-split form could not carry it.
  const script = "process.exit(process.argv[1] === 'a b' ? 0 : 1)"
  const reviewed = (): void => {
    startTicket()
    go(['status', 'T-001', 'Review'])
    pass('T-001', 'council')
  }

  it('takes the check as separate arguments with --check-arg', () => {
    reviewed()
    const r = go(['merge', 'T-001', '--as', 'merger', '--check', 'node', '--check-arg', '-e', '--check-arg', script, '--check-arg', 'a b'])
    expect(r.code, r.err).toBe(0)
    expect(r.json.outcome).toBe('merged')
  })

  it('takes everything after "--check --" as the check command', () => {
    reviewed()
    const r = go(['merge', 'T-001', '--as', 'merger', '--check', '--', 'node', '-e', script, 'a b'])
    expect(r.code, r.err).toBe(0)
    expect(r.json.outcome).toBe('merged')
  })

  it('refuses a check that cannot run before it merges anything', () => {
    if (process.platform !== 'win32') return
    startTicket()
    go(['status', 'T-001', 'Review'])
    pass('T-001', 'council')
    const head = git(repo, 'rev-parse', 'HEAD')
    const r = go(['merge', 'T-001', '--as', 'merger', '--check', 'node -e "x"'])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/cannot take an argument containing/)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('removes only the ticket own worktree and branch, whatever the board says', () => {
    const tree = startTicket()
    git(repo, 'branch', 'precious')
    expect(go(['set', 'T-001', 'branch', 'precious']).code).toBe(1)
    const r = go(['worktree', 'remove', 'T-001'])
    expect(r.code).toBe(0)
    expect(r.json).toMatchObject({ removed: true, branchDeleted: false, forced: false }) // unmerged branch is kept by git branch -d
    expect(readFileSync(join(repo, '.foreman/tickets/T-001/log.md'), 'utf8')).toMatch(/worktree removed=true forced=false; branch -d not done: .*not fully merged/)
    expect(existsSync(tree)).toBe(false)
    expect(git(repo, 'branch', '--list', 'precious')).toContain('precious')
    expect(go(['worktree', 'remove', '-x']).code).toBe(1)
  })

  it.each([[['--check', '--']], [['--check', '']], [['--check-arg', 'x']]])('refuses an empty check %j before merging anything', (flags) => {
    reviewed()
    const head = git(repo, 'rev-parse', 'HEAD')
    const r = go(['merge', 'T-001', '--as', 'merger', ...flags])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/--check was given but holds no command|--check-arg needs --check/)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
  })
})
