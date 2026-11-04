import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatChild } from './claude-chat'
import { Foreman, type CliAccess, type Scheduler } from './foreman'
import { SessionManager, type Pty, type PtyFactory } from './sessions'
import { Store } from './store'
import type { CliTarget } from './cli-server'
import type { ChatOp, ChatState } from '../shared/claude-chat'

class FakePty implements Pty {
  written: string[] = []
  exit: (e: { exitCode: number }) => void = () => {}
  constructor(
    readonly file: string,
    readonly opts: { cwd: string; env: Record<string, string> },
  ) {}
  write(d: string) {
    this.written.push(d)
    if (d.includes('/exit')) this.exit({ exitCode: 0 })
  }
  resize() {}
  kill() {
    this.exit({ exitCode: 0 })
  }
  onData() {}
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exit = cb
  }
}

class FakeChatChild extends EventEmitter {
  written: Array<Record<string, any>> = []
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    write: (s: string) => {
      for (const l of s.split('\n')) if (l) this.written.push(JSON.parse(l))
      return true
    },
    end: () => this.emit('close', 0, null),
    on: () => undefined,
  }
  kill() {
    this.emit('close', null, 'SIGTERM')
  }
  out(o: unknown) {
    this.stdout.emit('data', `${JSON.stringify(o)}\n`)
  }
}

const cli: CliAccess = { address: '/tmp/op.sock', issueToken: (id) => `t${id}`, revokeToken: () => undefined, listen: async () => '/tmp/op.sock', close: async () => undefined }
const scheduler: Scheduler = { every: () => ({}), cancel: () => undefined }

describe('Foreman: Chat view tiles', () => {
  let store: Store
  let op: Foreman
  let ptys: FakePty[]
  let children: Array<{ spawn: { file: string; args: string[]; env: Record<string, string>; shell: boolean }; child: FakeChatChild }>
  let bin: string
  let pushed: Array<{ scratchId: number; ops: ChatOp[] }>
  let target: CliTarget

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'foreman-bin-'))
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'claude'), '')
    store = new Store(':memory:')
    ptys = []
    children = []
    pushed = []
    const spawn: PtyFactory = (file, _args, opts) => {
      const p = new FakePty(file, opts)
      ptys.push(p)
      return p
    }
    op = new Foreman({
      store,
      sessions: new SessionManager(spawn),
      pluginDir: '/plugin',
      engineeringDir: '/data/engineering',
      transcriptFile: (_cwd, id) => join(bin, `${id}.jsonl`),
      cliServer: (t) => ((target = t), cli),
      scheduler,
      now: () => Date.now(),
      launch: { platform: 'linux', launchDir: '/data/launch', rolesDir: '/data/roles', cliDir: '/app/cli', foremanNode: '/app/foreman', baseEnv: { PATH: bin }, writer: { mkdir: () => {}, writeFile: () => {} } },
      chatSpawn: (spec) => {
        const child = new FakeChatChild()
        children.push({ spawn: spec, child })
        return child as unknown as ChatChild
      },
    })
    op.on('chat:ops', (e) => pushed.push(e))
  })
  afterEach(() => {
    store.close()
    rmSync(bin, { recursive: true, force: true })
  })

  const makeTile = (agent: 'claude' | 'shell' = 'claude') => {
    const crew = store.listCrews().find((c) => c.name === 'shop') ?? store.createCrew('shop', '/code/shop')
    return op.handlers['scratch:create']({ crewId: crew.id, title: 'work', agent, model: 'claude-sonnet-5-5' }) as { id: number; view: string }
  }
  const lastChild = () => children.at(-1)!

  it('foreman shot saves the file and shows a shot notice with the image in the tile chat', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'foreman-shot-proj-'))
    try {
      const crew = store.createCrew('shots', folder)
      const t = op.handlers['scratch:create']({ crewId: crew.id, title: 'work', agent: 'claude', model: 'claude-sonnet-5-5' }) as { id: number }
      op.startScratch(t.id)
      const file = join(bin, 'x.png')
      writeFileSync(file, 'png-bytes')
      const who = target.identify(t.id)!
      expect(who.tileId).toBe(t.id)
      const r = await target.run(who, { cmd: 'shot', args: { file, kind: 'Home' } })
      expect(r.exit).toBe(0)
      expect(existsSync(r.out!)).toBe(true)
      const notice = (await op.handlers['chat:snapshot'](t.id)).items.find((i) => i.kind === 'notice' && i.source === 'shot')
      expect(notice).toMatchObject({ tone: 'info', images: [{ mediaType: 'image/png' }] })
      expect(notice?.kind === 'notice' && notice.text).toMatch(/^Screenshot saved: docs\/specs\/screenshots\/home-/)
      const bad = await target.run(who, { cmd: 'shot', args: { file: 'rel.png' } })
      expect(bad.exit).toBe(1)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('a project with Engineering and Orchestration on starts its Chat tile with the preamble, the engineering pack, no Foreman plugin dir and FOREMAN_FACTORY; a plain project does not', () => {
    const plain = store.createCrew('plain', '/code/plain')
    const t0 = op.handlers['scratch:create']({ crewId: plain.id, title: 'a', agent: 'claude', model: 'claude-sonnet-5-5' }) as { id: number }
    op.startScratch(t0.id)
    const off = lastChild().spawn
    expect(off.args).not.toContain('--append-system-prompt-file')
    expect(off.args.filter((a) => a === '--plugin-dir')).toHaveLength(1)
    expect(off.env.FOREMAN_FACTORY).toBeUndefined()

    const crew = store.createCrew('modes', '/code/modes')
    expect(crew).toMatchObject({ engineering: false, factory: false })
    expect(op.handlers['crews:update'](crew.id, { engineering: true, factory: true })).toMatchObject({ engineering: true, factory: true })
    expect(() => op.handlers['crews:update'](crew.id, { factory: 'yes' as unknown as boolean })).toThrow()
    const t1 = op.handlers['scratch:create']({ crewId: crew.id, title: 'b', agent: 'claude', model: 'claude-sonnet-5-5' }) as { id: number }
    op.startScratch(t1.id)
    const on = lastChild().spawn
    expect(on.args.filter((a) => a === '--append-system-prompt-file')).toHaveLength(1)
    expect(on.args).toContain(join('/data/engineering', 'engineering'))
    expect(on.args).not.toContain(join('/data/engineering', 'factory'))
    expect(on.args).not.toContain('/plugin')
    expect(on.env.FOREMAN_FACTORY).toBe('1')
  })

  // A Foreman whose pluginDir is the real one, so the shipped kit is what gets installed.
  const kitForeman = () =>
    new Foreman({
      store,
      sessions: new SessionManager((file, _args, opts) => new FakePty(file, opts)),
      pluginDir: join(__dirname, '..', 'plugin'),
      engineeringDir: '/data/engineering',
      transcriptFile: (_cwd, id) => join(bin, `${id}.jsonl`),
      cliServer: (t) => ((target = t), cli),
      scheduler,
      now: () => Date.now(),
      launch: { platform: 'linux', launchDir: '/data/launch', rolesDir: '/data/roles', cliDir: '/app/cli', foremanNode: '/app/foreman', baseEnv: { PATH: bin }, writer: { mkdir: () => {}, writeFile: () => {} } },
      chatSpawn: (spec) => {
        const child = new FakeChatChild()
        children.push({ spawn: spec, child })
        return child as unknown as ChatChild
      },
    })
  const tileOf = (o: Foreman, crewId: number, agent: 'claude' | 'shell') => o.handlers['scratch:create']({ crewId, title: 'k', agent, model: 'claude-sonnet-5-5' }) as { id: number }

  it('installs the Orchestration kit when the folder of a project with Orchestration on changes, and at tile start', () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-kit-'))
    try {
      const real = kitForeman()
      const a = join(root, 'a')
      const b = join(root, 'b')
      const c = join(root, 'c')
      for (const d of [a, b, c]) mkdirSync(d)
      const crew = store.createCrew('kit', a)
      real.handlers['crews:update'](crew.id, { factory: true })
      expect(existsSync(join(a, '.claude/agents/builder.md'))).toBe(true)
      expect(existsSync(join(b, '.claude'))).toBe(false)
      real.handlers['crews:update'](crew.id, { folder: b })
      expect(existsSync(join(b, '.claude/agents/builder.md'))).toBe(true)
      real.handlers['crews:update'](crew.id, { name: 'renamed' })
      real.handlers['crews:update'](crew.id, { folder: c, factory: false })
      expect(existsSync(join(c, '.claude'))).toBe(false)
      real.handlers['crews:update'](crew.id, { factory: true })
      expect(existsSync(join(c, '.claude/agents/builder.md'))).toBe(true)
      rmSync(join(c, '.claude'), { recursive: true })
      real.startScratch(tileOf(real, crew.id, 'claude').id)
      expect(existsSync(join(c, '.claude/agents/builder.md'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves shell tiles alone, creates no missing folder, survives a failed install and logs only changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-kit-'))
    try {
      const real = kitForeman()
      const lines: string[] = []
      real.on('event', (e: { kind: string; message: string }) => lines.push(`${e.kind}: ${e.message}`))
      const kitLines = () => lines.filter((l) => l.includes('Orchestration kit'))

      const dir = join(root, 'p')
      mkdirSync(dir)
      const crew = store.createCrew('lean', dir)
      real.handlers['crews:update'](crew.id, { factory: true })
      rmSync(join(dir, '.claude'), { recursive: true })
      lines.length = 0
      real.startScratch(tileOf(real, crew.id, 'shell').id)
      expect(existsSync(join(dir, '.claude'))).toBe(false)

      real.startScratch(tileOf(real, crew.id, 'claude').id)
      expect(kitLines()).toHaveLength(1)
      real.startScratch(tileOf(real, crew.id, 'claude').id)
      expect(kitLines()).toHaveLength(1)

      const gone = join(root, 'gone')
      const missing = store.createCrew('missing', gone)
      real.handlers['crews:update'](missing.id, { factory: true })
      expect(existsSync(gone)).toBe(false)
      expect(kitLines().some((l) => l.startsWith('error') && l.includes('does not exist'))).toBe(true)

      const file = join(root, 'a-file')
      writeFileSync(file, 'x')
      const broken = store.createCrew('broken', file)
      real.handlers['crews:update'](broken.id, { factory: true })
      const before = children.length
      expect(() => real.startScratch(tileOf(real, broken.id, 'claude').id)).not.toThrow()
      expect(kitLines().filter((l) => l.startsWith('error')).length).toBeGreaterThan(1)
      expect(children.length).toBe(before + 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('opens new Claude tiles in the Chat view, other tiles in the Terminal view', () => {
    expect(makeTile().view).toBe('chat')
    expect(makeTile('shell').view).toBe('terminal')
  })

  it('starts one stream-json process with the tile launch flags and the cleaned environment', () => {
    const t = makeTile()
    const status = op.startScratch(t.id)
    expect(status).toMatchObject({ running: true, view: 'chat' })
    expect(ptys).toHaveLength(0)
    const { spawn, child } = lastChild()
    expect(spawn.file).toBe(join(bin, 'claude'))
    expect(spawn.shell).toBe(false)
    expect(spawn.args.slice(0, 5)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json'])
    expect(spawn.args).toContain('--session-id')
    expect(spawn.env.FOREMAN_SOCKET).toBe('/tmp/op.sock')
    expect(spawn.env.FOREMAN_TOKEN).toBe(`t${t.id}`)
    expect(child.written[0]).toMatchObject({ request: { subtype: 'initialize' } })
    expect(op.handlers['chat:snapshot'](t.id)).toMatchObject({ scratchId: t.id, process: 'starting' })
    // already running: left alone
    op.startScratch(t.id)
    expect(children).toHaveLength(1)
  })

  it('blocks the tile when Claude Code is not on PATH', () => {
    rmSync(join(bin, 'claude'))
    const t = makeTile()
    op.startScratch(t.id)
    expect(children).toHaveLength(0)
    expect(op.handlers['chat:snapshot'](t.id)).toMatchObject({ process: 'blocked' })
  })

  it('pushes batched ops, takes messages and prompt answers through the handlers', () => {
    const t = makeTile()
    op.startScratch(t.id)
    const { child } = lastChild()
    op.handlers['chat:send'](t.id, { text: 'hello' })
    expect(child.written.at(-1)).toMatchObject({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } })
    child.out({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu' } })
    op.chat.flush()
    expect(pushed.length).toBeGreaterThan(0)
    expect(pushed.flatMap((p) => p.ops).some((o) => o.op === 'upsert' && o.item.kind === 'permission')).toBe(true)
    op.handlers['chat:permission'](t.id, 'r1', { kind: 'allow' })
    expect(child.written.at(-1)).toMatchObject({ type: 'control_response', response: { request_id: 'r1', response: { behavior: 'allow' } } })
    expect(() => op.handlers['chat:permission'](t.id, 'r1', { kind: 'allow' })).toThrow(/no longer waiting/)
    expect(() => op.handlers['chat:send'](t.id, { text: 5 as unknown as string })).toThrow()
    op.handlers['chat:setEffort'](t.id, 'high')
    expect(store.getScratch(t.id)!.effort).toBe('high')
    expect(() => op.handlers['chat:setEffort'](t.id, 'galaxy')).toThrow()
  })

  it('a Claude process that exits after the database closed (quit during a turn) does not throw', () => {
    const t = makeTile()
    op.startScratch(t.id)
    // As after Store.close(): reads throw. (The real close stays for afterEach.)
    vi.spyOn(store, 'isOpen', 'get').mockReturnValue(false)
    vi.spyOn(store, 'getScratch').mockImplementation(() => {
      throw new Error('database is not open')
    })
    expect(() => lastChild().child.emit('close', 0, null)).not.toThrow()
  })

  it('queue handlers reorder, refuse, take and remove messages held while Claude works', () => {
    const t = makeTile()
    op.startScratch(t.id)
    const { child } = lastChild()
    for (const text of ['go', 'later', 'last', 'extra']) op.handlers['chat:send'](t.id, { text })
    const queue = () => (op.handlers['chat:snapshot'](t.id) as ChatState).queue
    expect(queue().map((q) => q.text)).toEqual(['later', 'last', 'extra'])
    expect(child.written.filter((w) => w.type === 'user')).toHaveLength(1)
    expect(() => op.handlers['chat:queueMove'](t.id, queue()[0]!.id, 2 as never)).toThrow()
    op.handlers['chat:queueMove'](t.id, queue()[1]!.id, -1)
    expect(queue().map((q) => q.text)).toEqual(['last', 'later', 'extra'])
    expect(() => op.handlers['chat:queueSend'](t.id, queue()[0]!.id)).toThrow(/not running/)
    expect(op.handlers['chat:queueTake'](t.id, queue()[0]!.id)).toEqual({ text: 'last' })
    op.handlers['chat:queueRemove'](t.id, queue()[1]!.id)
    expect(queue().map((q) => q.text)).toEqual(['later'])
    expect(op.handlers['chat:queueTake'](t.id, 'gone')).toBeNull()
  })

  it('switches Chat -> Terminal -> Chat between turns on the same session', async () => {
    const t = makeTile()
    op.startScratch(t.id)
    const sessionId = store.getScratch(t.id)!.sessionId!
    const first = lastChild()
    first.child.out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-5-5', permissionMode: 'default' })
    op.handlers['chat:send'](t.id, { text: 'busy' })
    await expect(op.handlers['scratch:setView'](t.id, 'terminal')).rejects.toMatchObject({ code: 'CONFLICT' })
    first.child.out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 5, total_cost_usd: 0.01 })
    writeFileSync(join(bin, `${sessionId}.jsonl`), '{}') // Claude has saved the turn

    const status = await op.handlers['scratch:setView'](t.id, 'terminal')
    expect(status).toMatchObject({ running: true, view: 'terminal', sessionId })
    expect(store.getScratch(t.id)!.view).toBe('terminal')
    expect(ptys).toHaveLength(1)
    expect(ptys[0]!.written.join('')).toContain(`--resume ${sessionId}`)
    expect(op.chat.has(t.id)).toBe(false)

    const back = await op.handlers['scratch:setView'](t.id, 'chat')
    expect(back).toMatchObject({ running: true, view: 'chat', sessionId })
    expect(ptys[0]!.written.join('')).toContain('/exit\r')
    expect(children).toHaveLength(2)
    expect(children[1]!.spawn.args).toContain('--resume')
  })

  it('switches a fresh tile (no turn yet, no transcript) with the same session id, never --resume', async () => {
    const t = makeTile()
    op.startScratch(t.id)
    const sessionId = store.getScratch(t.id)!.sessionId!
    lastChild().child.out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-5-5', permissionMode: 'default' })

    const exits: { switching?: boolean }[] = []
    op.on('scratch:exit', (e) => void exits.push(e))
    const status = await op.handlers['scratch:setView'](t.id, 'terminal')
    expect(status).toMatchObject({ running: true, view: 'terminal', sessionId })
    // The chat process ended for the switch: the tile must not be shown as exited.
    expect(exits).toEqual([expect.objectContaining({ switching: true })])
    const cmd = ptys[0]!.written.join('')
    expect(cmd).toContain(`--session-id ${sessionId}`)
    expect(cmd).not.toContain('--resume')

    const back = await op.handlers['scratch:setView'](t.id, 'chat')
    expect(back).toMatchObject({ running: true, view: 'chat', sessionId })
    expect(children).toHaveLength(2)
    expect(children[1]!.spawn.args).toContain('--session-id')
    expect(children[1]!.spawn.args).not.toContain('--resume')
    expect(store.getScratch(t.id)!.sessionId).toBe(sessionId)
  })

  it('keeps the old view and clears the switching flag when the other side cannot start', async () => {
    const t = makeTile()
    op.startScratch(t.id)
    lastChild().child.out({ type: 'system', subtype: 'init', session_id: store.getScratch(t.id)!.sessionId, model: 'claude-opus-5-5', permissionMode: 'default' })
    store.updateScratch(t.id, { model: 'bad model;' })
    await expect(op.handlers['scratch:setView'](t.id, 'terminal')).rejects.toBeTruthy()
    expect(store.getScratch(t.id)!.view).toBe('chat')
    store.updateScratch(t.id, { model: 'claude-sonnet-5-5' })
    await expect(op.handlers['scratch:setView'](t.id, 'terminal')).resolves.toMatchObject({ view: 'terminal' })
    await expect(op.handlers['scratch:setView'](t.id, 'chat')).resolves.toMatchObject({ view: 'chat' })
  })

  it('refuses a view switch for tiles that are not Claude Code', async () => {
    const t = makeTile('shell')
    await expect(op.handlers['scratch:setView'](t.id, 'chat')).rejects.toMatchObject({ code: 'BAD_ARGS' })
  })

  it('keeps the old conversation items when a closed tile is reopened with resume', async () => {
    const t = makeTile()
    op.startScratch(t.id)
    op.handlers['chat:send'](t.id, { text: 'first question' })
    op.stopScratch(t.id)
    await op.chat.stop(t.id)
    op.startScratch(t.id, { resume: true })
    expect(children).toHaveLength(2)
    const texts = (await op.handlers['chat:snapshot'](t.id)).items.map((i) => (i.kind === 'user' ? i.text : i.kind))
    expect(texts).toContain('first question')
    expect(children[1]!.spawn.args).toContain('--session-id')
  })

  describe('thread history', () => {
    const MIN = 60_000
    let changed: Array<{ crewId: number; scratchId: number }>
    const titled = (title: string) => {
      const crew = store.listCrews().find((c) => c.name === 'shop') ?? store.createCrew('shop', '/code/shop')
      const t = op.handlers['scratch:create']({ crewId: crew.id, title, agent: 'claude', model: 'claude-sonnet-5-5' }) as { id: number; crewId: number }
      op.startScratch(t.id)
      changed.length = 0
      return t
    }
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      changed = []
      op.on('scratch:changed', (e) => void changed.push(e))
    })
    afterEach(() => vi.useRealTimers())

    it('names a tile with its default title from the first line of the first message, cut to 60 characters, and announces it', () => {
      const t = titled('Claude: shop')
      op.handlers['chat:send'](t.id, { text: `\n  Fix the login bug  \nand then the logout one` })
      expect(store.getScratch(t.id)!.title).toBe('Fix the login bug')
      expect(changed).toEqual([{ crewId: t.crewId, scratchId: t.id }])
      op.handlers['chat:send'](t.id, { text: 'second message' })
      expect(store.getScratch(t.id)!.title).toBe('Fix the login bug')

      const long = titled('Reviewer: shop')
      op.handlers['chat:send'](long.id, { text: 'x'.repeat(100) })
      const title = store.getScratch(long.id)!.title
      expect(title).toBe(`${'x'.repeat(59)}…`)
      expect(title).toHaveLength(60)
    })

    it('announces a tile that is created and one that is deleted', () => {
      const crew = store.listCrews().find((c) => c.name === 'shop') ?? store.createCrew('shop', '/code/shop')
      const t = op.handlers['scratch:create']({ crewId: crew.id, title: 'Claude: shop', agent: 'claude', model: 'claude-sonnet-5-5' }) as { id: number; crewId: number }
      op.handlers['scratch:delete'](t.id)
      expect(changed).toEqual([
        { crewId: t.crewId, scratchId: t.id },
        { crewId: t.crewId, scratchId: t.id },
      ])
    })

    it('never overwrites a title the owner set', () => {
      const t = titled('Claude: shop')
      op.handlers['scratch:update'](t.id, { title: 'Payments rewrite' })
      op.handlers['chat:send'](t.id, { text: 'hello there' })
      expect(store.getScratch(t.id)!.title).toBe('Payments rewrite')
    })

    it('moves updatedAt when a message is sent and when a turn ends', () => {
      const t = titled('Payments rewrite')
      const born = store.getScratch(t.id)!.updatedAt
      const sessionId = store.getScratch(t.id)!.sessionId
      lastChild().child.out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-5-5', permissionMode: 'default' })
      vi.advanceTimersByTime(MIN)
      op.handlers['chat:send'](t.id, { text: 'go' })
      op.chat.flush()
      const sent = store.getScratch(t.id)!.updatedAt
      // The store's clock is not the faked one, so compare with a margin instead of to the millisecond.
      expect(sent - born).toBeGreaterThan(MIN - 1000)
      vi.advanceTimersByTime(MIN)
      lastChild().child.out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 5, total_cost_usd: 0.01 })
      op.chat.flush()
      expect(store.getScratch(t.id)!.updatedAt - sent).toBe(MIN)
      expect(changed).toHaveLength(2)
    })

    it('keeps the row and its session when the owner stops the chat, and resumes it', async () => {
      const t = titled('Claude: shop')
      const sessionId = store.getScratch(t.id)!.sessionId
      op.handlers['chat:send'](t.id, { text: 'remember me' })
      op.handlers['scratch:stop'](t.id)
      await op.chat.stop(t.id)
      expect(op.scratchStatus(t.id).running).toBe(false)
      expect(store.getScratch(t.id)).toMatchObject({ title: 'remember me', sessionId })
      expect(op.handlers['scratch:start'](t.id, true)).toMatchObject({ running: true, sessionId })
      expect(children[1]!.spawn.args).toContain(sessionId)
      expect(store.listScratch(t.crewId).map((s) => s.id)).toContain(t.id)
    })
  })

  it('stops chat processes on quit', async () => {
    const t = makeTile()
    op.startScratch(t.id)
    await op.shutdown()
    expect(op.chat.isRunning(t.id)).toBe(false)
  })
})

void vi
