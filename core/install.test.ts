import { describe, expect, it } from 'vitest'
import { Installer, chromiumInstalled, playwrightBrowsersDir, type InstallDeps } from './install'

const deps = (code: number, calls: string[] = [], over: Partial<InstallDeps> = {}): InstallDeps => ({
  run: async (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    return { code, stdout: '', stderr: code === 0 ? '' : 'boom' }
  },
  claudeDir: 'nowhere',
  platform: 'win32',
  env: {},
  listDir: () => [],
  ...over,
})

describe('Installer', () => {
  it('runs the uv fallback when winget fails', async () => {
    const calls: string[] = []
    const r = await new Installer(deps(1, calls)).run('uv')
    expect(calls).toEqual(['winget install --id astral-sh.uv -e', 'pip install uv'])
    expect(r).toEqual({ id: 'uv', ok: false, error: 'boom' })
  })

  it('refuses ids it does not run', async () => {
    expect((await new Installer(deps(0)).run('dictation')).ok).toBe(false)
  })

  it('reports each tool', async () => {
    const list = await new Installer(deps(1)).status()
    expect(list.find((s) => s.id === 'uv')?.state).toBe('missing')
    expect(list.find((s) => s.id === 'dictation')?.state).toBe('unknown')
    expect(list.find((s) => s.id === 'playwright')?.state).toBe('missing')
  })

  it('finds a downloaded Chromium', () => {
    expect(chromiumInstalled(['ffmpeg-1011', 'chromium-1148'])).toBe(true)
    expect(chromiumInstalled(['firefox-1']))
      .toBe(false)
    expect(playwrightBrowsersDir({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'H')).toMatch(/ms-playwright$/)
  })
})
