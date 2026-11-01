import { describe, expect, it } from 'vitest'
import { buildClaudeRunLaunch, buildScratchLaunch, commandLine, e2eClaudeModel, opencodeConfigContent, quoteArg, type LaunchContext } from './launch'
import type { ScratchTerminal } from '../shared/types'

const ctx: LaunchContext = {
  platform: 'linux',
  crewId: 1,
  crewFolder: '/code/shop',
  pluginDir: '/app/plugin',
  launchDir: '/tmp/launch',
  rolesDir: '/tmp/roles',
  sessionId: '6f1c0f1e-5a4b-4c3d-8e2f-123456789abc',
  foremanCli: '/app/cli/foreman',
  foremanNode: '/app/foreman',
}

const tile = (over: Partial<ScratchTerminal> = {}): ScratchTerminal => ({
  id: 7,
  crewId: 1,
  title: 'work',
  agent: 'claude',
  model: 'claude-sonnet-5-5',
  effort: '',
  presetId: null,
  cwd: '/code/shop',
  sessionId: null,
  view: 'terminal',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('tile launches', () => {
  it('adds a CodeGraph MCP config file only when codegraphMcp is set', () => {
    const on = buildScratchLaunch(tile(), { ...ctx, codegraphMcp: true })
    const f = on.files.find((x) => x.path.endsWith('codegraph-mcp.json'))
    expect(JSON.parse(f!.content)).toEqual({ mcpServers: { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] } } })
    expect(on.args).toContain(f!.path)
    expect(buildScratchLaunch(tile(), ctx).files.some((x) => x.path.endsWith('codegraph-mcp.json'))).toBe(false)
  })

  it('passes one --plugin-dir per enabled native Claude mod, and none when there are none', () => {
    const on = buildScratchLaunch(tile(), { ...ctx, modPlugins: ['/app/plugin/mods/ideaShelf', '/app/plugin/mods/folderTracker'] })
    expect(on.args.filter((a) => a === '--plugin-dir')).toHaveLength(3)
    expect(on.args).toEqual(expect.arrayContaining(['/app/plugin/mods/ideaShelf', '/app/plugin/mods/folderTracker']))
    const off = buildScratchLaunch(tile(), { ...ctx, modPlugins: [] })
    expect(off.args.filter((a) => a === '--plugin-dir')).toHaveLength(1)
  })

  it('adds --mcp-config and a secret-free browser-mcp.json only when browserMcp is set', () => {
    const on = buildScratchLaunch(tile(), { ...ctx, browserMcp: { url: 'http://127.0.0.1:53817/mcp' } })
    const i = on.args.indexOf('--mcp-config')
    expect(on.args[i + 1]).toBe('/tmp/launch/browser-mcp.json')
    const f = on.files.find((x) => x.path === '/tmp/launch/browser-mcp.json')
    expect(JSON.parse(f?.content ?? '{}')).toEqual({
      mcpServers: { 'foreman-browser': { type: 'http', url: 'http://127.0.0.1:53817/mcp', headers: { Authorization: 'Bearer ${FOREMAN_TOKEN}' } } },
    })
    expect(f?.content).not.toContain('@@FOREMAN_TOKEN@@')
    const off = buildScratchLaunch(tile(), ctx)
    expect(off.args).not.toContain('--mcp-config')
    expect(off.files.some((x) => x.path.endsWith('browser-mcp.json'))).toBe(false)
    const unsupported = buildScratchLaunch(tile(), { ...ctx, supported: new Set(['--model']), browserMcp: { url: 'http://127.0.0.1:1/mcp' } })
    expect(unsupported.args).not.toContain('--mcp-config')
  })

  it('gives OpenCode tiles the browser as a remote MCP server only when browserMcp is set, with no literal token', () => {
    const on = buildScratchLaunch(tile({ agent: 'opencode' }), { ...ctx, browserMcp: { url: 'http://127.0.0.1:53817/mcp' } })
    expect(on.files).toEqual([])
    const content = on.env.OPENCODE_CONFIG_CONTENT ?? ''
    expect(JSON.parse(content)).toEqual({
      mcp: { servers: { 'foreman-browser': { type: 'remote', url: 'http://127.0.0.1:53817/mcp', headers: { Authorization: 'Bearer {env:FOREMAN_TOKEN}' }, disabled: false } } },
    })
    expect(content).not.toContain('@@FOREMAN_TOKEN@@')
    expect(on.env.OPENCODE_CLI_CONFIG_CONTENT).toBe(JSON.stringify({ tabs: { mode: 'off' } }))
    expect(on.env.FOREMAN_TOKEN).toBe('@@FOREMAN_TOKEN@@')
    const off = buildScratchLaunch(tile({ agent: 'opencode' }), ctx)
    expect(off.env).not.toHaveProperty('OPENCODE_CONFIG_CONTENT')
  })

  it('merges the browser MCP server into an existing OpenCode overlay', () => {
    const base = JSON.stringify({ mcp: { servers: { b: { disabled: true } }, other: 1 }, theme: 'x' })
    const merged = JSON.parse(opencodeConfigContent({ browserMcp: { url: 'http://127.0.0.1:1/mcp' } }, base) ?? '{}')
    expect(merged.theme).toBe('x')
    expect(merged.mcp.other).toBe(1)
    expect(merged.mcp.servers.b).toEqual({ disabled: true })
    expect(merged.mcp.servers['foreman-browser'].type).toBe('remote')
    expect(opencodeConfigContent({}, base)).toBe(base)
    expect(opencodeConfigContent({})).toBeNull()
  })

  it('adds the recall file and the CodeGraph server to the OpenCode overlay only when asked', () => {
    expect(opencodeConfigContent({ recallFile: undefined, codegraphMcp: false })).toBeNull()
    const both = JSON.parse(opencodeConfigContent({ recallFile: '/data/recall/abc.txt', codegraphMcp: true }) ?? '{}')
    expect(both.instructions).toEqual(['/data/recall/abc.txt'])
    expect(both.mcp.servers.codegraph).toEqual({ type: 'local', command: ['codegraph', 'serve', '--mcp'] })
    const recallOnly = JSON.parse(opencodeConfigContent({ recallFile: '/data/recall/abc.txt' }) ?? '{}')
    expect(recallOnly.mcp).toBeUndefined()
    const cgOnly = JSON.parse(opencodeConfigContent({ codegraphMcp: true }, JSON.stringify({ instructions: ['x.md'] })) ?? '{}')
    expect(cgOnly.instructions).toEqual(['x.md'])
    expect(cgOnly).not.toHaveProperty('instructions.1')
    const merged = JSON.parse(opencodeConfigContent({ recallFile: '/r.txt' }, JSON.stringify({ instructions: ['x.md'] })) ?? '{}')
    expect(merged.instructions).toEqual(['x.md', '/r.txt'])
  })

  it('starts a Claude tile with the plugin dir and the CLI token placeholders', () => {
    const l = buildScratchLaunch(tile(), ctx)
    expect(l.file).toBe('claude')
    expect(l.args).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-5-5', '--plugin-dir', '/app/plugin', '--session-id']))
    expect(l.env).toMatchObject({ FOREMAN_TOKEN: '@@FOREMAN_TOKEN@@', FOREMAN_SOCKET: '@@FOREMAN_SOCKET@@' })
    expect(l.files).toEqual([])
  })

  it('passes --effort to Haiku 5.5 and leaves it out for Haiku 4.5', () => {
    const haiku5 = buildScratchLaunch(tile({ model: 'claude-haiku-5-5', effort: 'high' }), ctx)
    expect(haiku5.args).toEqual(expect.arrayContaining(['--effort', 'high']))
    const haiku4 = buildScratchLaunch(tile({ model: 'claude-haiku-4-5', effort: 'high' }), ctx)
    expect(haiku4.args).not.toContain('--effort')
  })

  it('writes a preset guidance text as an appended system prompt file', () => {
    const l = buildScratchLaunch(tile({ presetId: 3 }), ctx, { preset: { id: 3, roleText: 'Be brief.' } as never })
    expect(l.args).toContain('--append-system-prompt-file')
    expect(l.files[0]!.content).toBe('Be brief.\n')
  })

  it('appends the mode preamble to the one guidance file, with the preset text first', () => {
    const modes = { modePreamble: 'Engineering Mode is on.' }
    const alone = buildScratchLaunch(tile(), { ...ctx, ...modes })
    expect(alone.args.filter((a) => a === '--append-system-prompt-file')).toHaveLength(1)
    expect(alone.files).toHaveLength(1)
    expect(alone.files[0]!.content).toBe('Engineering Mode is on.\n')
    expect(alone.args[alone.args.indexOf('--append-system-prompt-file') + 1]).toBe(alone.files[0]!.path)
    const withPreset = buildScratchLaunch(tile({ presetId: 3 }), { ...ctx, ...modes }, { preset: { id: 3, roleText: 'Be brief.' } as never })
    expect(withPreset.args.filter((a) => a === '--append-system-prompt-file')).toHaveLength(1)
    expect(withPreset.files[0]!.content).toBe('Be brief.\n\nEngineering Mode is on.\n')
    expect(buildScratchLaunch(tile(), { ...ctx, modePreamble: '' }).args).not.toContain('--append-system-prompt-file')
  })

  it('passes a --plugin-dir per mode pack and sets FOREMAN_FACTORY only when Factory is on', () => {
    const on = buildScratchLaunch(tile(), { ...ctx, packPlugins: ['/data/engineering/engineering', '/data/engineering/factory'], factory: true })
    const dirs = on.args.flatMap((a, i) => (a === '--plugin-dir' ? [on.args[i + 1]] : []))
    expect(dirs).toEqual(['/app/plugin', '/data/engineering/engineering', '/data/engineering/factory'])
    expect(on.env.FOREMAN_FACTORY).toBe('1')
    const eng = buildScratchLaunch(tile(), { ...ctx, packPlugins: ['/data/engineering/engineering'] })
    expect(eng.args.filter((a) => a === '--plugin-dir')).toHaveLength(2)
    expect(eng.env).not.toHaveProperty('FOREMAN_FACTORY')
    expect(buildScratchLaunch(tile(), ctx).env).not.toHaveProperty('FOREMAN_FACTORY')
    expect(() => buildScratchLaunch(tile(), { ...ctx, packPlugins: ['/x\ny'] })).toThrow()
  })

  it('leaves the mode pack off non-Claude tiles', () => {
    const l = buildScratchLaunch(tile({ agent: 'codex' }), { ...ctx, modePreamble: 'x', packPlugins: ['/p'], factory: true })
    expect(l.args).toEqual(['-m', 'claude-sonnet-5-5'])
    expect(l.env).not.toHaveProperty('FOREMAN_FACTORY')
  })

  it('has nothing to type for a shell tile and an OpenCode tile starts its TUI', () => {
    expect(buildScratchLaunch(tile({ agent: 'shell' }), ctx)).toMatchObject({ file: null, args: [] })
    expect(buildScratchLaunch(tile({ agent: 'opencode' }), ctx)).toMatchObject({ file: 'opencode', args: [] })
  })

  it('quotes arguments for the shell it types into', () => {
    expect(quoteArg("it's", 'sh')).toBe("'it'" + String.fromCharCode(92) + "''s'")
    expect(commandLine({ file: 'claude', args: ['--model', 'a b'] }, 'powershell')).toBe("claude --model 'a b'")
  })

  it('adds the MCP config, strict flag and the one allowed tool to a run only when claude supports them', () => {
    const run = { cwd: '/code/shop', mcpConfig: '/tmp/cg.json', allowedTools: 'mcp__codegraph__codegraph_explore' }
    expect(buildClaudeRunLaunch(run).args).toEqual(expect.arrayContaining(['--mcp-config', '"/tmp/cg.json"', '--strict-mcp-config', '--allowedTools', 'mcp__codegraph__codegraph_explore']))
    expect(buildClaudeRunLaunch({ cwd: '/code/shop' }).args).not.toContain('--mcp-config')
    expect(buildClaudeRunLaunch(run, { supported: new Set(['--mcp-config']) }).args).toEqual(expect.arrayContaining(['--mcp-config']))
    expect(buildClaudeRunLaunch(run, { supported: new Set(['--mcp-config']) }).args).not.toContain('--allowedTools')
    expect(buildClaudeRunLaunch(run, { supported: new Set() }).args).not.toContain('--mcp-config')
  })

  it('forces Haiku for Claude only in an e2e run', () => {
    expect(e2eClaudeModel('claude-sonnet-5-5', {})).toBe('claude-sonnet-5-5')
    expect(e2eClaudeModel('claude-sonnet-5-5', { FOREMAN_E2E: '1' })).toBe('claude-haiku-5-5')
    expect(e2eClaudeModel(undefined, { FOREMAN_E2E: '1' })).toBe('claude-haiku-5-5')
    const old = process.env.FOREMAN_E2E
    process.env.FOREMAN_E2E = '1'
    try {
      expect(buildScratchLaunch(tile(), ctx).args).toEqual(expect.arrayContaining(['--model', 'claude-haiku-5-5']))
      expect(buildClaudeRunLaunch({ cwd: '/code/shop', model: 'claude-sonnet-5-5' }).args).toEqual(expect.arrayContaining(['--model', 'claude-haiku-5-5']))
      expect(buildScratchLaunch(tile({ agent: 'codex', model: 'gpt-5' }), ctx).args).toEqual(['-m', 'gpt-5'])
    } finally {
      if (old === undefined) delete process.env.FOREMAN_E2E
      else process.env.FOREMAN_E2E = old
    }
  })
})
