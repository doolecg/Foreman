import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings'
import { FIRST_START_ITEMS, INSTALL_ITEMS, firstStartItems, installItems, MCP_RUNTIME_INSTALL, canRunInstall, commandText, installAttempts, lastErrorLine, shouldShowSetup, stateFromVersionRun, statusLabel, toolRowNames } from './install'

describe('install', () => {
  it('lists each tool once, with the MCP servers merged into their tool rows', () => {
    const names = toolRowNames()
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(INSTALL_ITEMS.map((i) => i.id)).size).toBe(INSTALL_ITEMS.length)
    expect(names).toContain('Playwright MCP and browser')
    expect(names).toContain('Git MCP')
    expect(names.filter((n) => /codegraph|hindsight/i.test(n))).toHaveLength(0)
  })

  it('maps a version run to a state', () => {
    expect(stateFromVersionRun('uv', { code: 0, stdout: 'uv 0.5.1 (abc)', stderr: '' })).toEqual({ id: 'uv', state: 'installed', version: '0.5.1' })
    expect(stateFromVersionRun('uv', { code: 1, stdout: '', stderr: "'uv' is not recognized" }).state).toBe('missing')
    expect(stateFromVersionRun('uv', { code: null, stdout: '', stderr: 'spawn uv ENOENT' }).state).toBe('missing')
    expect(stateFromVersionRun('uv', { code: null, stdout: '', stderr: '' }).state).toBe('unknown')
  })

  it('lists the exact commands', () => {
    expect(commandText('opencode', 'linux')).toBe('npm i -g @opencode/cli')
    expect(commandText('playwright', 'win32')).toBe('npx playwright install chromium')
    expect(commandText('superpowers', 'win32')).toBe('claude plugin install superpowers@claude-plugins-official')
    expect(commandText('claude', 'win32')).toBe('claude install')
    expect(installAttempts('uv', 'win32')).toEqual([
      { file: 'winget', args: ['install', '--id', 'astral-sh.uv', '-e'] },
      { file: 'pip', args: ['install', 'uv'] },
    ])
    expect(installAttempts('uv', 'linux')).toEqual([{ file: 'pip', args: ['install', 'uv'] }])
    expect(installAttempts('dictation', 'win32')).toEqual([])
  })

  it('offers the right items at first start', () => {
    expect(FIRST_START_ITEMS.map((i) => i.id)).toEqual(['opencode', 'uv', 'playwright', 'superpowers', 'dictation'])
    expect(INSTALL_ITEMS.find((i) => i.id === 'claude')).toMatchObject({ optional: false, firstStart: false, runnable: false })
  })

  it('installs Node.js and the runtimes of the optional MCP servers', () => {
    expect(commandText('nodejs', 'win32')).toBe('winget install --id OpenJS.NodeJS.LTS -e')
    expect(installAttempts('nodejs', 'linux')).toEqual([])
    expect(INSTALL_ITEMS.find((i) => i.id === 'nodejs')).toMatchObject({ optional: true, firstStart: false, runnable: true })
    expect(FIRST_START_ITEMS.map((i) => i.id)).not.toContain('nodejs')
    expect(MCP_RUNTIME_INSTALL).toEqual({ git: 'uv', playwright: 'nodejs' })
    expect(canRunInstall('nodejs', 'win32')).toBe(true)
    expect(canRunInstall('nodejs', 'linux')).toBe(false)
    expect(canRunInstall('dictation', 'linux')).toBe(true)
    expect(stateFromVersionRun('nodejs', { code: 0, stdout: 'v24.20.0', stderr: '' })).toEqual({ id: 'nodejs', state: 'installed', version: '24.20.0' })
  })

  it('shows the setup once', () => {
    expect(DEFAULT_SETTINGS.setupDone).toBe(false)
    expect(shouldShowSetup(undefined)).toBe(false)
    expect(shouldShowSetup(false)).toBe(true)
    expect(shouldShowSetup(true)).toBe(false)
    expect(sanitizeSettings({ setupDone: true }).setupDone).toBe(true)
    expect(sanitizeSettings({ setupDone: 'yes' }).setupDone).toBe(false)
  })

  it('keys the install list and first-start defaults to the default CLI', () => {
    const optionalOf = (list: ReturnType<typeof installItems>, id: string) => list.find((i) => i.id === id)?.optional
    expect(optionalOf(installItems('claude'), 'claude')).toBe(false)
    expect(optionalOf(installItems('claude'), 'opencode')).toBe(true)
    const noClaude = [{ id: 'claude' as const, state: 'missing' as const }]
    const oc = installItems('opencode', noClaude)
    expect(optionalOf(oc, 'opencode')).toBe(false)
    expect(optionalOf(oc, 'claude')).toBe(true)
    expect(oc.map((i) => i.id)).not.toContain('superpowers')
    expect(firstStartItems('opencode', noClaude).map((i) => i.id)).toEqual(['opencode', 'uv', 'playwright', 'dictation'])
    expect(installItems('opencode', [{ id: 'claude', state: 'installed' }]).map((i) => i.id)).toContain('superpowers')
    expect(installItems('claude', noClaude).map((i) => i.id)).toContain('superpowers')
    expect(firstStartItems('claude').map((i) => i.id)).toEqual(FIRST_START_ITEMS.map((i) => i.id))
  })

  it('labels statuses', () => {
    expect(statusLabel({ id: 'uv', state: 'installed', version: '1.2.3' })).toBe('Installed 1.2.3')
    expect(statusLabel({ id: 'uv', state: 'missing' })).toBe('Not installed')
    expect(statusLabel(undefined)).toBe('Unknown')
  })

  it('keeps the last error line', () => {
    expect(lastErrorLine('warn\n\nnpm ERR! code EACCES\n')).toBe('npm ERR! code EACCES')
    expect(lastErrorLine('')).toBe('The install failed')
  })
})
