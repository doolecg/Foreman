import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'
import { execHiddenSync } from './proc'
import { updateTicket } from './tickets'
import type { TicketRow } from '../shared/tickets'

// One git worktree and one branch per ticket, plus the Merger. Bundled into plugin/kit/foreman/tickets.mjs, so it uses only
// node builtins and core/proc.ts. Every git call passes an argument array (never a shell string), and the branch and the
// worktree path are always derived from the ticket id, never read from the board, so a forged Branch or Worktree cell
// cannot point git at another branch or folder.

export type Isolation = { isolation: 'none' } | { isolation: 'worktree'; branch: string; worktree: string }

// Same shape the ticket store accepts. Checked here too so an id can never reach git as an option.
const ID_RE = /^T-\d{3,}$/
function assertId(id: string): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`Invalid ticket id: ${String(id)}`)
}

export function ticketBranch(id: string): string {
  assertId(id)
  return `foreman/${id}`
}

export function ticketWorktree(root: string, id: string): string {
  assertId(id)
  return resolve(root, id)
}

function git(cwd: string, args: string[]): string {
  const r = execHiddenSync('git', args, { cwd })
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n')[0] || `git ${args[0]} failed`)
  return r.stdout.trim()
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

const norm = (p: string): string => {
  try {
    return realpathSync(p).toLowerCase()
  } catch {
    return resolve(p).toLowerCase()
  }
}
const same = (a: string, b: string): boolean => norm(a) === norm(b)

// True only when the folder itself is the top of a git work tree (a project inside some other repo is not isolated).
export function isGitRepo(folder: string): boolean {
  if (!existsSync(folder)) return false
  const top = tryGit(folder, ['rev-parse', '--show-toplevel'])
  return top !== null && top !== '' && same(top, folder)
}

export function defaultWorktreeRoot(project: string): string {
  const p = resolve(project)
  return join(dirname(p), '.foreman-worktrees', basename(p))
}

const branchExists = (repo: string, branch: string): boolean => tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null

// Uncommitted changes in a work tree. The ticket store lives in .foreman and is not part of the code being merged.
function isDirty(tree: string, untracked: boolean): boolean {
  return git(tree, ['status', '--porcelain', ...(untracked ? [] : ['--untracked-files=no']), '--', '.', ':(exclude).foreman']) !== ''
}

// True when git lists this folder as a worktree checked out on this branch.
function isRegisteredWorktree(repo: string, path: string, branch: string): boolean {
  let current: string | null = null
  for (const line of git(repo, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim()
    else if (line.startsWith('branch ') && current !== null && line.slice('branch '.length).trim() === `refs/heads/${branch}` && same(current, path)) return true
  }
  return false
}

export function createWorktree(repo: string, ticketId: string, root: string): Isolation {
  const branch = ticketBranch(ticketId)
  if (!isGitRepo(repo)) return { isolation: 'none' }
  if (branchExists(repo, branch)) throw new Error(`branch ${branch} already exists`)
  const path = ticketWorktree(root, ticketId)
  if (existsSync(path)) throw new Error(`${path} already exists`)
  tryGit(repo, ['worktree', 'prune']) // a record of a folder that was deleted by hand would block the add
  mkdirSync(dirname(path), { recursive: true })
  try {
    git(repo, ['worktree', 'add', '-b', branch, path])
  } catch (e) {
    throw new Error(`git worktree add failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { isolation: 'worktree', branch, worktree: path }
}

export interface RemoveResult {
  removed: boolean
  branchDeleted: boolean
  forced: boolean
  // Why git branch -d refused, when it did.
  branchError?: string
}

// Removes this ticket's own worktree (root/<id>, which git must list on foreman/<id>) and deletes foreman/<id> with the
// safe -d, so an unmerged branch is kept. A worktree with changes is refused unless force is set; the caller sets it only
// for a Failed ticket.
export function removeWorktree(repo: string, ticketId: string, root: string, force = false): RemoveResult {
  const branch = ticketBranch(ticketId)
  const worktree = ticketWorktree(root, ticketId)
  let removed = false
  if (existsSync(worktree)) {
    if (!isRegisteredWorktree(repo, worktree, branch)) throw new Error(`${worktree} is not the worktree of ${branch}`)
    if (!force && isDirty(worktree, true)) throw new Error(`${worktree} has uncommitted changes`)
    try {
      git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), worktree])
      removed = true
    } catch (e) {
      throw new Error(`git worktree remove failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  let branchDeleted = false
  let branchError: string | undefined
  if (branchExists(repo, branch)) {
    try {
      git(repo, ['branch', '-d', branch])
      branchDeleted = true
    } catch (e) {
      branchError = e instanceof Error ? e.message : String(e)
    }
  }
  return { removed, branchDeleted, forced: force && removed, ...(branchError ? { branchError } : {}) }
}

export const describeRemoval = (r: RemoveResult): string =>
  `worktree removed=${r.removed} forced=${r.forced}; branch -d ${r.branchDeleted ? 'ok' : `not done${r.branchError ? `: ${r.branchError}` : ''}`}`

export interface MergeOptions {
  // Where the ticket worktrees live (the same root worktree create used).
  worktreeRoot: string
  // Branches that are never merged into, besides main, master and the remote's default branch. Compared case-insensitively.
  protect?: string[]
  // Runs the post-merge check in the main work tree and resolves with its exit code. The caller holds the test lock.
  // A throw counts as a failed check.
  runCheck?: () => Promise<number>
  log: (text: string) => void
}

export type MergeResult =
  | { outcome: 'merged'; target: string; preSha: string; mergeSha: string; worktreeRemoved: boolean; branchDeleted: boolean }
  | { outcome: 'conflict'; target: string; preSha: string; conflict: string[] }
  | { outcome: 'check-failed'; target: string; preSha: string; mergeSha: string; revertSha: string; reason: string; warning?: string }

// "heads/main" is what --short prints when a tag or remote has the same name.
const branchName = (ref: string): string => ref.replace(/^heads\//, '')

function defaultBranch(repo: string): string | null {
  const ref = tryGit(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  return ref ? branchName(ref.replace(/^origin\//, '')) : null
}

// Merges foreman/<id> into the branch checked out in the main work tree. A refusal throws; a conflict or a failed check is a result.
// Never pushes, never touches another branch, never resolves a conflict.
export async function mergeTicket(repo: string, ticket: TicketRow, opts: MergeOptions): Promise<MergeResult> {
  const id = ticket.id
  const branch = ticketBranch(id)
  const worktree = ticketWorktree(opts.worktreeRoot, id)
  if (!isGitRepo(repo)) throw new Error(`merge ${id}: ${repo} is not a git repository`)
  if (ticket.status !== 'Review') throw new Error(`merge ${id}: status is ${ticket.status}, not Review`)
  if (ticket.verification !== 'Passed') throw new Error(`merge ${id}: verification is ${ticket.verification}, not Passed`)
  if (!branchExists(repo, branch)) throw new Error(`merge ${id}: branch ${branch} does not exist`)
  if (existsSync(worktree) && isDirty(worktree, true)) throw new Error(`merge ${id}: worktree ${worktree} has uncommitted changes`)
  if (isDirty(repo, false)) throw new Error(`merge ${id}: the main working tree has uncommitted changes`)

  const head = tryGit(repo, ['symbolic-ref', '--short', 'HEAD'])
  if (!head) throw new Error(`merge ${id}: the main working tree is on a detached HEAD`)
  const target = branchName(head)
  const protectedNames = ['main', 'master', defaultBranch(repo), ...(opts.protect ?? [])].filter((n): n is string => !!n).map((n) => n.trim().toLowerCase())
  if (protectedNames.includes(target.toLowerCase())) throw new Error(`merge ${id}: ${target} is protected; check out a dev branch (you merge to ${target} yourself)`)
  if (git(repo, ['rev-list', '--count', `${target}..${branch}`]) === '0') {
    throw new Error(`merge ${id}: branch commits are already in ${target} (reverted?); revert the revert or make a new commit on ${branch}`)
  }

  const preSha = git(repo, ['rev-parse', 'HEAD'])
  opts.log(`merge ${branch} into ${target}, pre-merge ${preSha}`)
  try {
    git(repo, ['merge', '--no-ff', branch, '-m', `Merge ${id}: ${ticket.title}`])
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const conflict = tryGit(repo, ['diff', '--name-only', '--diff-filter=U'])?.split('\n').filter(Boolean) ?? []
    if (tryGit(repo, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']) !== null) {
      try {
        git(repo, ['merge', '--abort'])
      } catch (abortError) {
        const why = abortError instanceof Error ? abortError.message : String(abortError)
        opts.log(`merge ${branch} into ${target} hit a conflict and git merge --abort failed: ${why}; the repo may be mid-merge`)
        updateTicket(repo, id, { integration: 'Failed' })
        throw new Error(`merge ${id}: conflict, but git merge --abort failed (${why}); ${repo} may be mid-merge, run git status`)
      }
    }
    if (!conflict.length) throw new Error(`merge ${id}: git merge failed: ${message}`)
    updateTicket(repo, id, { integration: 'Failed' })
    opts.log(`merge conflict, aborted, back at ${preSha}: ${conflict.join(', ')}`)
    return { outcome: 'conflict', target, preSha, conflict }
  }
  const mergeSha = git(repo, ['rev-parse', 'HEAD'])

  // From here the target branch holds the merge. Anything that goes wrong before the ticket is marked Merged undoes it.
  let failure: string | null = null
  try {
    if (opts.runCheck && (await opts.runCheck()) !== 0) failure = 'the check failed'
    else updateTicket(repo, id, { integration: 'Merged' })
  } catch (e) {
    failure = `the check could not run: ${e instanceof Error ? e.message : String(e)}`
  }
  if (failure !== null) {
    try {
      git(repo, ['revert', '-m', '1', '--no-edit', mergeSha])
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      tryGit(repo, ['revert', '--abort'])
      updateTicket(repo, id, { integration: 'Failed' })
      opts.log(`${failure}; merge ${mergeSha} NOT reverted, the revert failed: ${message}`)
      throw new Error(`merge ${id}: ${failure} and the revert failed (${message}); ${target} is at merge ${mergeSha}`)
    }
    const revertSha = git(repo, ['rev-parse', 'HEAD'])
    // The revert is done; a failure to record it must show in the result and the log, not replace the result.
    let warning: string | undefined
    try {
      updateTicket(repo, id, { integration: 'Failed' })
    } catch (e) {
      warning = `merge was reverted but integration could not be set to Failed: ${e instanceof Error ? e.message : String(e)}`
    }
    opts.log(`${failure}; merge ${mergeSha} reverted by ${revertSha}${warning ? `; ${warning}` : ''}`)
    return { outcome: 'check-failed', target, preSha, mergeSha, revertSha, reason: failure, ...(warning ? { warning } : {}) }
  }

  opts.log(`merged ${branch} into ${target} as ${mergeSha}`)
  // The merge already counts; a cleanup problem is logged, not raised.
  let cleanup: RemoveResult = { removed: false, branchDeleted: false, forced: false }
  try {
    cleanup = removeWorktree(repo, id, opts.worktreeRoot)
    opts.log(describeRemoval(cleanup))
    if (cleanup.removed) updateTicket(repo, id, { worktree: '' })
  } catch (e) {
    opts.log(`merged, but cleanup failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { outcome: 'merged', target, preSha, mergeSha, worktreeRemoved: cleanup.removed, branchDeleted: cleanup.branchDeleted }
}
