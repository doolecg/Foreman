import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Foreman, type CliAccess, type Scheduler } from './foreman'
import { SessionManager, type Pty, type PtyFactory } from './sessions'
import { Store } from './store'
import { EventEmitter } from 'node:events'
import type { ChatChild } from './claude-chat'

class FakePty implements Pty {
  write() {}
  resize() {}
  kill() {}
  onData() {}
  onExit() {}
}

class FakeChatChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { write: () => true, end: () => this.emit('close', 0, null), on: () => undefined }
  kill() {
    this.emit('close', null, 'SIGTERM')
  }
}

const cli: CliAccess = { address: '/tmp/op.sock', issueToken: (id) => `t${id}`, revokeToken: () => undefined, listen: async () => '/tmp/op.sock', close: async () => undefined }
const scheduler: Scheduler = { every: () => ({}), cancel: () => undefined }

describe('Foreman: Lite sessions', () => {
  let store: Store
  let op: Foreman
  let root: string
  let folder: string
  let written: Map<string, string>
  let spawned: Array<{ args: string[] }>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'foreman-lite-'))
    const bin = join(root, 'bin')
    const cfg = join(root, 'cfg')
    folder = join(root, 'shop')
    for (const d of [bin, cfg, folder]) mkdirSync(d, { recursive: true })
    writeFileSync(join(bin, 'claude'), '')
    // User scope has a, b and c; .mcp.json has a and b; the project's local scope (key in another case, with a slash) has a.
    writeFileSync(
      join(cfg, '.claude.json'),
      JSON.stringify({
        mcpServers: { a: { from: 'user' }, b: { from: 'user' }, c: { from: 'user' }, d: { from: 'user' } },
        projects: { [`${folder.toUpperCase()}/`]: { mcpServers: { a: { from: 'local' } } }, [join(root, 'other')]: { mcpServers: { d: { from: 'other project' } } } },
      }),
    )
    writeFileSync(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { a: { from: 'project' }, b: { from: 'project' } } }))
    store = new Store(':memory:')
    written = new Map()
    spawned = []
    const spawn: PtyFactory = () => new FakePty()
    op = new Foreman({
      store,
      sessions: new SessionManager(spawn),
      pluginDir: '/plugin',
      transcriptFile: (_cwd, id) => join(root, `${id}.jsonl`),
      cliServer: () => cli,
      scheduler,
      now: () => Date.now(),
      launch: {
        platform: 'linux',
        launchDir: '/data/launch',
        rolesDir: '/data/roles',
        cliDir: '/app/cli',
        foremanNode: '/app/foreman',
        baseEnv: { PATH: bin, CLAUDE_CONFIG_DIR: cfg },
        writer: { mkdir: () => {}, writeFile: (path, content) => void written.set(path, content) },
      },
      chatSpawn: (spec) => {
        spawned.push({ args: spec.args })
        return new FakeChatChild() as unknown as ChatChild
      },
    })
  })
  afterEach(() => {
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  const tile = (lite?: boolean) => {
    const crew = store.listCrews().find((c) => c.name === 'shop') ?? store.createCrew('shop', folder)
    return op.handlers['scratch:create']({ crewId: crew.id, title: 'work', agent: 'claude', model: 'claude-sonnet-5-5', ...(lite ? { lite } : {}) }) as { id: number }
  }

  it('Lite file holds the allowlisted servers: local beats project beats user, other projects and unknown names are left out', () => {
    op.handlers['settings:set']({ lite: { mcpServers: ['a', 'b', 'c', 'd', 'missing'], plugins: [] } })
    const t = tile(true)
    op.startScratch(t.id)
    const args = spawned.at(-1)!.args
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(`/data/launch/lite-${t.id}.json`)
    expect(JSON.parse(written.get(`/data/launch/lite-${t.id}.json`)!)).toEqual({
      mcpServers: { a: { from: 'local' }, b: { from: 'project' }, c: { from: 'user' }, d: { from: 'user' } },
    })
  })

  it('two Lite tiles get their own file', () => {
    const a = tile(true)
    const b = tile(true)
    op.startScratch(a.id)
    op.startScratch(b.id)
    expect(written.has(`/data/launch/lite-${a.id}.json`)).toBe(true)
    expect(written.has(`/data/launch/lite-${b.id}.json`)).toBe(true)
  })

  it('a normal tile is not Lite', () => {
    op.startScratch(tile().id)
    expect(spawned.at(-1)!.args).not.toContain('--strict-mcp-config')
  })

  it('the Lite flag does not outlive its tile: delete clears it, and a new tile on a reused id starts normal', () => {
    const t = tile(true)
    expect(store.getJson(`lite.${t.id}`)).toBe(true)
    op.handlers['scratch:delete'](t.id)
    expect(store.getJson(`lite.${t.id}`)).toBeUndefined()
    // A stale flag left behind (older data) is overwritten when a tile is created.
    store.setJson('lite.1', true)
    store.setJson('lite.2', true)
    const fresh = tile()
    expect(store.getJson(`lite.${fresh.id}`)).toBe(false)
  })
})
