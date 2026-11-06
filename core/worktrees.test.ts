import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimTicket, createTicket, getTicket, setStatus, updateTicket } from './tickets'
import { createWorktree, isGitRepo, mergeTicket, removeWorktree, type MergeOptions } from './worktrees'

let base: string
let repo: string
let wtRoot: string

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commitAll = (cwd: string, message: string): void => {
  sh(cwd, 'add', '-A', '--', '.', ':!.foreman')
  sh(cwd, 'commit', '-m', message)
}
const log = (text: string): void => void text
const opts = (extra: Partial<MergeOptions> = {}): MergeOptions => ({ worktreeRoot: wtRoot, log, ...extra })

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fm-worktrees-'))
  repo = join(base, 'proj')
  wtRoot = join(base, 'wt')
  mkdirSync(repo)
  sh(repo, 'init', '-b', 'dev-x')
  sh(repo, 'config', 'user.name', 'Test')
  sh(repo, 'config', 'user.email', 'test@example.com')
  sh(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  commitAll(repo, 'start')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

// A claimed ticket with a worktree and one commit on its branch, left In Progress.
function started(file = 'b.txt', content = 'new\n'): { id: string; worktree: string } {
  const { id } = createTicket(repo, { title: 'Add b', rd: '', eval: 'b exists' })
  setStatus(repo, id, 'Ready')
  claimTicket(repo, id, 'w1')
  const made = createWorktree(repo, id, wtRoot)
  if (made.isolation !== 'worktree') throw new Error('expected a worktree')
  updateTicket(repo, id, { branch: made.branch, worktree: made.worktree })
  writeFileSync(join(made.worktree, file), content)
  commitAll(made.worktree, 'work')
  return { id, worktree: made.worktree }
}
function toReview(id: string, verification: 'Passed' | 'Pending' = 'Passed') {
  setStatus(repo, id, 'Review')
  updateTicket(repo, id, { verification })
  return getTicket(repo, id).ticket
}

describe('createWorktree', () => {
  it('makes the branch and the folder outside the project, and the folder is a checkout', () => {
    const { id, worktree } = started()
    expect(worktree.startsWith(repo)).toBe(false)
    expect(existsSync(join(worktree, 'a.txt'))).toBe(true)
    expect(sh(repo, 'branch', '--list', `foreman/${id}`)).toContain(`foreman/${id}`)
    expect(sh(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('dev-x')
    expect(() => createWorktree(repo, id, wtRoot)).toThrow(/already exists/)
  })

  it('returns isolation none for a folder that is not a git repo', () => {
    const plain = join(base, 'plain')
    mkdirSync(plain)
    expect(isGitRepo(plain)).toBe(false)
    expect(isGitRepo(repo)).toBe(true)
    expect(createWorktree(plain, 'T-001', wtRoot)).toEqual({ isolation: 'none' })
    expect(existsSync(wtRoot)).toBe(false)
  })
})

describe('removeWorktree', () => {
  it('refuses a dirty worktree, and keeps an unmerged branch', () => {
    const { id, worktree } = started()
    writeFileSync(join(worktree, 'b.txt'), 'edited\n')
    expect(() => removeWorktree(repo, id, wtRoot)).toThrow(/uncommitted/)
    commitAll(worktree, 'more')
    const r = removeWorktree(repo, id, wtRoot)
    expect(r).toMatchObject({ removed: true, branchDeleted: false, forced: false })
    expect(r.branchError).toMatch(/not fully merged/)
    expect(sh(repo, 'branch', '--list', `foreman/${id}`)).not.toBe('')
  })
})

describe('mergeTicket', () => {
  it('merges into a dev branch, marks Merged, removes the worktree and the branch, and pushes nothing', async () => {
    const { id, worktree } = started()
    const pre = sh(repo, 'rev-parse', 'HEAD')
    const lines: string[] = []
    const r = await mergeTicket(repo, toReview(id), opts({ log: (t) => lines.push(t), runCheck: async () => 0 }))
    expect(r.outcome).toBe('merged')
    if (r.outcome !== 'merged') return
    expect(r.preSha).toBe(pre)
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(r.mergeSha)
    expect(sh(repo, 'log', '-1', '--format=%s')).toBe('Merge T-001: Add b')
    expect(sh(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3) // a real merge commit
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('new\n') // Windows checkouts may turn LF into CRLF
    const row = getTicket(repo, id).ticket
    expect(row.integration).toBe('Merged')
    expect(row.worktree).toBe('')
    expect(existsSync(worktree)).toBe(false)
    expect(sh(repo, 'branch', '--list', `foreman/${id}`)).toBe('')
    expect(lines.join('\n')).toContain(r.mergeSha)
    expect(sh(repo, 'remote')).toBe('')
  })

  it.each(['main', 'master'])('refuses to merge into %s', async (name) => {
    const { id } = started()
    const row = toReview(id)
    sh(repo, 'checkout', '-b', name)
    await expect(mergeTicket(repo, row, opts())).rejects.toThrow(/protected/)
    expect(sh(repo, 'branch', '--list', `foreman/${id}`)).not.toBe('')
  })

  it('refuses when verification is not Passed, the status is not Review, or a tree is dirty', async () => {
    const { id, worktree } = started()
    await expect(mergeTicket(repo, getTicket(repo, id).ticket, opts())).rejects.toThrow(/not Review/)
    const row = toReview(id, 'Pending')
    await expect(mergeTicket(repo, row, opts())).rejects.toThrow(/not Passed/)
    const passed = updateTicket(repo, id, { verification: 'Passed' })
    writeFileSync(join(worktree, 'b.txt'), 'dirty\n')
    await expect(mergeTicket(repo, passed, opts())).rejects.toThrow(/worktree .* uncommitted/)
    sh(worktree, 'checkout', '--', 'b.txt')
    writeFileSync(join(repo, 'a.txt'), 'dirty\n')
    await expect(mergeTicket(repo, passed, opts())).rejects.toThrow(/main working tree has uncommitted/)
  })

  it('aborts a conflict cleanly, marks Integration Failed and names the files', async () => {
    const { id, worktree } = started('a.txt', 'theirs\n')
    writeFileSync(join(repo, 'a.txt'), 'ours\n')
    commitAll(repo, 'ours')
    const head = sh(repo, 'rev-parse', 'HEAD')
    const r = await mergeTicket(repo, toReview(id), opts())
    expect(r).toMatchObject({ outcome: 'conflict', conflict: ['a.txt'], preSha: head })
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(sh(repo, 'status', '--porcelain', '--untracked-files=no')).toBe('')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(getTicket(repo, id).ticket.integration).toBe('Failed')
    expect(existsSync(worktree)).toBe(true)
  })

  it('reverts the merge with a revert commit when the check fails', async () => {
    const { id } = started()
    const lines: string[] = []
    const r = await mergeTicket(repo, toReview(id), opts({ log: (t) => lines.push(t), runCheck: async () => 1 }))
    expect(r.outcome).toBe('check-failed')
    if (r.outcome !== 'check-failed') return
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(r.revertSha)
    expect(sh(repo, 'log', '-1', '--format=%s')).toMatch(/^Revert /)
    expect(sh(repo, 'merge-base', '--is-ancestor', r.mergeSha, 'HEAD')).toBe('') // history kept
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(getTicket(repo, id).ticket.integration).toBe('Failed')
    expect(lines.join('\n')).toContain(r.mergeSha)
    expect(lines.join('\n')).toContain(r.revertSha)
    expect(sh(repo, 'branch', '--list', `foreman/${id}`)).not.toBe('')
  })

  it('reverts the merge when the check cannot even start (it throws)', async () => {
    const { id } = started()
    const lines: string[] = []
    const r = await mergeTicket(repo, toReview(id), opts({ log: (t) => lines.push(t), runCheck: async () => Promise.reject(new Error('lock busy')) }))
    expect(r).toMatchObject({ outcome: 'check-failed', reason: 'the check could not run: lock busy' })
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(sh(repo, 'log', '-1', '--format=%s')).toMatch(/^Revert /)
    expect(getTicket(repo, id).ticket.integration).toBe('Failed')
    expect(lines.join(' ')).toContain('lock busy')
  })

  it('also protects the branches named in protect, ignoring case', async () => {
    const { id } = started()
    const row = toReview(id)
    await expect(mergeTicket(repo, row, opts({ protect: ['DEV-X'] }))).rejects.toThrow(/protected/)
    expect(sh(repo, 'branch', '--list', `foreman/${id}`)).not.toBe('')
  })

  it('protects the remote default branch, and strips heads/ from a branch name', async () => {
    const { id } = started()
    const row = toReview(id)
    sh(repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    sh(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    sh(repo, 'checkout', '-b', 'trunk')
    await expect(mergeTicket(repo, row, opts())).rejects.toThrow(/trunk is protected/)
  })

  it('derives the branch and the worktree from the id, so a forged board cell cannot redirect git', async () => {
    const { id } = started()
    sh(repo, 'branch', 'precious')
    const row = { ...toReview(id), branch: 'precious', worktree: repo }
    // The merge ignores the forged cells: it merges foreman/<id> and cleans up root/<id> only.
    const r = await mergeTicket(repo, row, opts({ runCheck: async () => 0 }))
    expect(r.outcome).toBe('merged')
    expect(sh(repo, 'branch', '--list', 'precious')).toContain('precious')
    expect(existsSync(join(repo, '.git'))).toBe(true)
  })

  it('refuses to remove a folder at root/<id> that is not that ticket worktree, and ids that look like options', () => {
    const { id } = started()
    removeWorktree(repo, id, wtRoot)
    mkdirSync(join(wtRoot, 'T-009'), { recursive: true })
    writeFileSync(join(wtRoot, 'T-009', 'keep.txt'), 'x')
    expect(() => removeWorktree(repo, 'T-009', wtRoot, true)).toThrow(/not the worktree of/)
    expect(existsSync(join(wtRoot, 'T-009', 'keep.txt'))).toBe(true)
    expect(() => createWorktree(repo, '-b', wtRoot)).toThrow(/Invalid ticket id/)
    expect(() => removeWorktree(repo, '--force', wtRoot)).toThrow(/Invalid ticket id/)
  })

  it('refuses a second merge after a revert, and never reports Merged', async () => {
    const { id } = started()
    const row = toReview(id)
    expect((await mergeTicket(repo, row, opts({ runCheck: async () => 1 }))).outcome).toBe('check-failed')
    const again = getTicket(repo, id).ticket
    await expect(mergeTicket(repo, again, opts({ runCheck: async () => 0 }))).rejects.toThrow(/already in dev-x \(reverted\?\); revert the revert or make a new commit on foreman\/T-001/)
    expect(getTicket(repo, id).ticket.integration).toBe('Failed')
  })

  it('creates a worktree even when git still has a record of a folder deleted by hand', () => {
    const stale = join(wtRoot, 'T-050')
    sh(repo, 'worktree', 'add', '--detach', stale)
    rmSync(stale, { recursive: true, force: true })
    expect(createWorktree(repo, 'T-050', wtRoot)).toMatchObject({ isolation: 'worktree', branch: 'foreman/T-050' })
    expect(existsSync(join(stale, 'a.txt'))).toBe(true)
  })
})
