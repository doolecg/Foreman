import { describe, expect, it } from 'vitest'
import { buildChatLaunch, buildScratchLaunch, type LaunchContext } from './launch'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings } from '../shared/settings'
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
  modPlugins: ['/app/plugin/mods/ideaShelf', '/app/plugin/mods/folderTracker'],
  packPlugins: ['/data/engineering/engineering', '/data/engineering/factory'],
  browserMcp: { url: 'http://127.0.0.1:53817/mcp' },
}

const tile = (): ScratchTerminal => ({
  id: 7,
  crewId: 1,
  title: 'work',
  agent: 'claude',
  model: 'claude-sonnet-5-5',
  effort: 'high',
  presetId: null,
  cwd: '/code/shop',
  sessionId: null,
  view: 'chat',
  createdAt: 0,
  updatedAt: 0,
})

const pluginDirs = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === '--plugin-dir' ? [a] : []))

describe('Lite launch', () => {
  it('leaves a normal launch unchanged', () => {
    const l = buildScratchLaunch(tile(), ctx)
    expect(l.args).not.toContain('--strict-mcp-config')
    expect(l.args).not.toContain('--setting-sources')
    expect(l.files.some((f) => f.path.endsWith('lite-7.json'))).toBe(false)
    expect(l.args[l.args.indexOf('--mcp-config') + 1]).toBe('/tmp/launch/browser-mcp.json')
    expect(pluginDirs(l.args)).toEqual(['/app/plugin', ...ctx.modPlugins!, ...ctx.packPlugins!])
    expect(buildScratchLaunch(tile(), ctx, { lite: undefined }).args).toEqual(l.args)
  })

  it('empty allowlists: strict MCP with no servers, the Foreman plugin only, no browser MCP', () => {
    const l = buildScratchLaunch(tile(), ctx, { lite: { mcpServers: {}, plugins: [] } })
    expect(l.args).toContain('--strict-mcp-config')
    expect(l.args).toEqual(expect.arrayContaining(['--setting-sources', 'project,local']))
    expect(l.args[l.args.indexOf('--mcp-config') + 1]).toBe('/tmp/launch/lite-7.json')
    expect(JSON.parse(l.files.find((f) => f.path.endsWith('lite-7.json'))!.content)).toEqual({ mcpServers: {} })
    expect(l.files.some((f) => f.path.endsWith('browser-mcp.json'))).toBe(false)
    expect(pluginDirs(l.args)).toEqual(['/app/plugin'])
  })

  it('writes only the given servers and keeps allowlisted mod and pack plugins', () => {
    const servers = { context7: { type: 'http', url: 'https://example.test/mcp' } }
    const l = buildScratchLaunch(tile(), ctx, { lite: { mcpServers: servers, plugins: ['ideaShelf', 'factory'] } })
    expect(JSON.parse(l.files.find((f) => f.path.endsWith('lite-7.json'))!.content)).toEqual({ mcpServers: servers })
    expect(pluginDirs(l.args)).toEqual(['/app/plugin', '/app/plugin/mods/ideaShelf', '/data/engineering/factory'])
  })

  it('Chat launches get the same Lite flags', () => {
    const l = buildChatLaunch(tile(), ctx, { lite: { mcpServers: {}, plugins: [] } })
    expect(l.args).toContain('--strict-mcp-config')
    expect(pluginDirs(l.args)).toEqual(['/app/plugin'])
  })

  it('drops --mcp-config when the install does not list it, but keeps the rest', () => {
    const l = buildScratchLaunch(tile(), { ...ctx, supported: new Set(['--model', '--strict-mcp-config', '--plugin-dir']) }, { lite: { mcpServers: {}, plugins: [] } })
    expect(l.args).not.toContain('--mcp-config')
    expect(l.args).toContain('--strict-mcp-config')
  })
})

describe('Lite settings', () => {
  it('defaults to empty allowlists and sanitizes bad input', () => {
    expect(DEFAULT_SETTINGS.lite).toEqual({ mcpServers: [], plugins: [] })
    expect(sanitizeSettings({}).lite).toEqual({ mcpServers: [], plugins: [] })
    expect(sanitizeSettings({ lite: { mcpServers: ['a', ' a ', 3, '', 'b'], plugins: 'x' } }).lite).toEqual({ mcpServers: ['a', 'b'], plugins: [] })
  })

  it('merges a patch', () => {
    const next = mergeSettings(sanitizeSettings({}), { lite: { plugins: ['ideaShelf'] } })
    expect(next.lite).toEqual({ mcpServers: [], plugins: ['ideaShelf'] })
  })
})
