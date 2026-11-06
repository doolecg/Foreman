// Command line for the ticket store, bundled by scripts/build-tickets-cli.mjs into plugin/kit/foreman/tickets.mjs.
// It calls the same functions the app uses, so every rule (transitions, Done gate, claim, locks) is enforced the same way.
import { appendFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnHidden, type HiddenSpawnOptions } from '../core/proc'
import { claimTicket, createTicket, getTicket, handoffTicket, listTickets, markCriterion, readAlerts, readCriteria, setVerification, readTouches, releaseTicket, setStatus, ticketsDir, updateTicket } from '../core/tickets'
import { planNext } from '../core/scheduler'
import { withTestLock } from '../core/test-lock'
import { createWorktree, defaultWorktreeRoot, describeRemoval, isGitRepo, mergeTicket, removeWorktree, ticketBranch, ticketWorktree } from '../core/worktrees'
import type { TicketIntegration, TicketMode, TicketStatus, TicketVerification } from '../shared/tickets'

const USAGE =
  'usage: tickets.mjs [--project <folder>] list | show <id> | next [--max N] | alerts | create (JSON on stdin) | status <id> <Status> | claim <id> <worker> | release <id> <worker> | set <id> verification|integration|branch|worktree <value> [--evidence "<text>"] | criteria <id> | criterion <id> <n> met|unmet --evidence "<text>" --as reviewer|council | handoff <id> <from> <to> --as router | log <id> <text> | test-lock -- <command...> | worktree create|remove <id> [--worktree-root <dir>] | merge <id> --as merger [--protect a,b] [--check "<command...>" | --check <program> --check-arg <arg>... | --check -- <command...>]'

const print = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

// Pulls "--name value" out of the list, wherever it is.
function takeFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (value === undefined) throw new Error(`${name} needs a value`)
  args.splice(i, 2)
  return value
}

// Actions that finish or condemn a ticket need a named actor who is not the ticket's own worker. This is a guard against
// accidents (a builder marking its own work Passed or Done), not a security boundary: anything that can run this CLI can
// type any --as value. Builders never pass --as.
const ACTORS = ['router', 'reviewer', 'merger', 'council']

function appendLog(project: string, id: string, text: string): string {
  getTicket(project, id) // refuses a bad or unknown id, so the path below stays inside .foreman/tickets
  const line = text.replace(/\s+/g, ' ')
  appendFileSync(join(ticketsDir(project), id, 'log.md'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  return line
}

function requireActor(project: string, id: string, actor: string | undefined, action: string, allowed: string[] = ACTORS): string {
  if (!actor || !allowed.includes(actor)) throw new Error(`${action} needs --as ${allowed.join('|')}`)
  const worker = getTicket(project, id).ticket.worker
  if (worker && worker === actor) throw new Error(`${action}: ${actor} is the worker of ${id} and cannot approve its own work`)
  return actor
}

// The command is the first word that is not one of our flags (or a flag's value).
function commandIndex(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (['--project', '--max', '--as', '--evidence', '--check', '--check-arg', '--worktree-root', '--protect'].includes(argv[i])) i++
    else return i
  }
  return -1
}

// The Windows shell re-parses the line and expands %VAR% or closes quotes early; refusing these is simpler than escaping them.
function assertRunnable(command: string[]): void {
  if (process.platform === 'win32' && command.some((a) => /["%]/.test(a))) throw new Error('On Windows a command cannot take an argument containing " or %')
}

// Runs a command with its output on the given stdio and resolves with its exit code.
function runCommand(command: string[], cwd: string, stdio: HiddenSpawnOptions['stdio']): Promise<number> {
  assertRunnable(command)
  return new Promise<number>((done, fail) => {
    // Windows needs a shell to find npx, npm and other .cmd files; the shell re-parses the line, so quote each part.
    // Backslashes before the closing quote would escape it, so they are doubled.
    const quote = (a: string): string => (/^[\w.:\/=@%+,-]+$/.test(a) ? a : `"${a.replace(/(\\+)$/, '$1$1')}"`)
    const child =
      process.platform === 'win32'
        ? spawnHidden(command.map(quote).join(' '), [], { cwd, stdio, shell: true, quiet: true })
        : spawnHidden(command[0], command.slice(1), { cwd, stdio, quiet: true })
    child.on('error', fail)
    child.on('close', (c) => done(c ?? 1))
  })
}

function need(args: string[], count: number): string[] {
  if (args.length < count) throw new Error(USAGE)
  return args
}

async function main(argv: string[]): Promise<number> {
  // Only for test-lock, everything after "--" is the command to run and must not be read as our own flags.
  const at = commandIndex(argv)
  // For merge, "--check -- <program> <args...>" does the same, so an argument can hold spaces.
  const dash =
    at !== -1 && argv[at] === 'test-lock'
      ? argv.indexOf('--', at)
      : at !== -1 && argv[at] === 'merge'
        ? argv.findIndex((a, i) => i > at && a === '--check' && argv[i + 1] === '--')
        : -1
  const tail = dash !== -1 && argv[at] === 'merge'
  const command = dash === -1 ? [] : argv.slice(dash + (tail ? 2 : 1))
  const args = dash === -1 ? [...argv] : argv.slice(0, dash)
  const project = resolve(takeFlag(args, '--project') ?? process.cwd())
  const max = takeFlag(args, '--max')
  const actor = takeFlag(args, '--as')
  const evidence = takeFlag(args, '--evidence')?.trim()
  const check = takeFlag(args, '--check')
  const checkArgs: string[] = []
  while (args.includes('--check-arg')) checkArgs.push(takeFlag(args, '--check-arg')!)
  const protect = takeFlag(args, '--protect')
  const worktreeRoot = resolve(takeFlag(args, '--worktree-root') ?? defaultWorktreeRoot(project))
  const cmd = args.shift()

  switch (cmd) {
    case 'list':
      print(listTickets(project))
      return 0
    case 'show':
      print(getTicket(project, need(args, 1)[0]))
      return 0
    case 'next': {
      const { tickets } = listTickets(project)
      const touches = Object.fromEntries(tickets.map((t) => [t.id, readTouches(project, t.id)]))
      print(planNext(tickets, { maxWorkers: max === undefined ? 3 : Number(max), touches }))
      return 0
    }
    case 'alerts':
      // Read only: the app's Watchdog writes alerts.json; an empty list means nothing to report (or the Watchdog is off).
      print(readAlerts(project))
      return 0
    case 'create': {
      const input = JSON.parse(readFileSync(0, 'utf8')) as {
        title: string
        rd?: string
        eval: string
        dependsOn?: Array<string | { id: string; reason?: string }>
        mode?: TicketMode
        touches?: string[]
      }
      // createTicket has no touches field: the scheduler reads them from a "Touches:" line in rd.md.
      const rd = [input.rd ?? '', input.touches?.length ? `Touches: ${input.touches.join(', ')}` : ''].filter(Boolean).join('\n\n')
      const dependsOn = (input.dependsOn ?? []).map((d) => (typeof d === 'string' ? { id: d, reason: '' } : { id: d.id, reason: d.reason ?? '' }))
      print(createTicket(project, { title: input.title, rd, eval: input.eval, dependsOn, mode: input.mode }))
      return 0
    }
    case 'status': {
      const [id, status] = need(args, 2)
      const guarded = status === 'Done' || status === 'Failed' ? requireActor(project, id, actor, `status ${status}`) : null
      const row = setStatus(project, id, status as TicketStatus)
      if (guarded) appendLog(project, id, `${status} approved by ${guarded}`)
      print(row)
      return 0
    }
    case 'claim': {
      const [id, worker] = need(args, 2)
      print(claimTicket(project, id, worker))
      return 0
    }
    case 'release': {
      const [id, worker] = need(args, 2)
      print(releaseTicket(project, id, worker))
      return 0
    }
    case 'set': {
      const [id, field, ...rest] = need(args, 3)
      const value = rest.join(' ')
      // Back to Pending is free (a rework resets it); any other verdict or integration result needs an approved actor.
      const guarded =
        field === 'verification' && value !== 'Pending'
          ? requireActor(project, id, actor, `set ${field} ${value}`, ['reviewer', 'council'])
          : field === 'integration' && value !== 'Pending'
            ? requireActor(project, id, actor, `set ${field} ${value}`, ['merger', 'router'])
            : null
      // A verdict must say why. Passed is also checked against eval.md, inside the store's lock (setVerification).
      if (guarded && field === 'verification' && !evidence) throw new Error(`set verification ${value} needs --evidence "<text>"`)
      if (field === 'verification') print(setVerification(project, id, value as TicketVerification))
      else if (field === 'integration') print(updateTicket(project, id, { integration: value as TicketIntegration }))
      else if (field === 'branch' || field === 'worktree') {
        // Only the ticket's own branch and worktree path: other values would let a later remove or merge reach another branch or folder.
        const own = field === 'branch' ? ticketBranch(id) : ticketWorktree(worktreeRoot, id)
        if (field === 'branch' ? value !== own : resolve(value) !== own) throw new Error(`set ${field}: only ${own} is allowed for ${id}`)
        print(updateTicket(project, id, { [field]: own }))
      }
      else throw new Error(`Cannot set ${field}; use verification, integration, branch or worktree`)
      if (guarded) appendLog(project, id, `${field} ${value} approved by ${guarded}${field === 'verification' && evidence ? `: ${evidence}` : ''}`)
      return 0
    }
    case 'criteria': {
      const [id] = need(args, 1)
      print(readCriteria(project, id))
      return 0
    }
    case 'criterion': {
      const [id, n, state] = need(args, 3)
      const by = requireActor(project, id, actor, 'criterion', ['reviewer', 'council'])
      if (state !== 'met' && state !== 'unmet') throw new Error('criterion needs met or unmet')
      if (!evidence) throw new Error('criterion needs --evidence "<text>"')
      print(markCriterion(project, id, Number(n), state === 'met', evidence, by))
      return 0
    }
    case 'handoff': {
      const [id, from, to] = need(args, 3)
      requireActor(project, id, actor, 'handoff', ['router'])
      print(handoffTicket(project, id, from, to))
      return 0
    }
    case 'log': {
      const [id, ...rest] = need(args, 2)
      print({ id, logged: appendLog(project, id, rest.join(' ')) })
      return 0
    }
    case 'test-lock': {
      if (!command.length) throw new Error('test-lock needs a command after "--"')
      const code = await withTestLock(project, () => runCommand(command, project, 'inherit'))
      process.stderr.write(`${JSON.stringify({ exitCode: code })}\n`)
      return code
    }
    case 'worktree': {
      const [sub, id] = need(args, 2)
      const { ticket } = getTicket(project, id)
      if (sub === 'create') {
        if (ticket.status !== 'In Progress' || !ticket.worker) throw new Error(`worktree create: ${id} must be In Progress and claimed`)
        const made = createWorktree(project, id, worktreeRoot)
        if (made.isolation === 'worktree') {
          updateTicket(project, id, { branch: made.branch, worktree: made.worktree })
          appendLog(project, id, `worktree ${made.worktree} on ${made.branch}`)
        }
        print(made)
        return 0
      }
      if (sub === 'remove') {
        if (!isGitRepo(project)) {
          print({ removed: false, branchDeleted: false, forced: false })
          return 0
        }
        // Force only for a Failed ticket, and only on the worktree derived from this id.
        const result = removeWorktree(project, id, worktreeRoot, ticket.status === 'Failed')
        if (result.removed) updateTicket(project, id, { worktree: '' })
        appendLog(project, id, describeRemoval(result))
        print(result)
        return 0
      }
      throw new Error(USAGE)
    }
    case 'merge': {
      const [id] = need(args, 1)
      requireActor(project, id, actor, 'merge', ['merger'])
      // Checked before the merge: a check that cannot start must not leave a merge behind.
      const checkCommand = tail ? command : checkArgs.length ? [...(check ? [check] : []), ...checkArgs] : (check?.split(/\s+/).filter(Boolean) ?? [])
      if (checkArgs.length && !check) throw new Error('merge: --check-arg needs --check <program>; nothing was merged')
      if (check !== undefined || tail) {
        if (!checkCommand.length) throw new Error('merge: --check was given but holds no command; nothing was merged')
      }
      assertRunnable(checkCommand)
      const result = await mergeTicket(project, getTicket(project, id).ticket, {
        worktreeRoot,
        protect: protect?.split(',').filter(Boolean),
        log: (text) => appendLog(project, id, text),
        runCheck: checkCommand.length ? () => withTestLock(project, () => runCommand(checkCommand, project, ['ignore', 2, 2])) : undefined,
      })
      if (result.outcome === 'conflict') {
        print({ conflict: result.conflict, target: result.target, preSha: result.preSha })
        return 2
      }
      print(result)
      return result.outcome === 'check-failed' ? 3 : 0
    }
    default:
      throw new Error(USAGE)
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (e: unknown) => {
    process.stderr.write(`error: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}\n`)
    process.exitCode = 1
  },
)
