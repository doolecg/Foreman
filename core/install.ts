import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { INSTALL_IDS, hindsightFromUv, installAttempts, lastErrorLine, stateFromVersionRun, type InstallId, type InstallResult, type InstallStatusItem } from '../shared/install'
import { detectSuperpowers } from './superpowers'
import { resolveCli, runHidden, type RunResult } from './proc'
import { PROGRAM_BINARY } from './tool-locations'

const PROBE_TIMEOUT_MS = 8000
const INSTALL_TIMEOUT_MS = 10 * 60_000

type Run = (cmd: string, args: string[], opts: { timeoutMs: number; shell: boolean }) => Promise<RunResult>

export interface InstallDeps {
  run: Run
  claudeDir: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  listDir: (dir: string) => string[]
}

export function systemInstallDeps(claudeDir: string): InstallDeps {
  return {
    run: (cmd, args, o) => runHidden(cmd, args, { timeoutMs: o.timeoutMs, shell: o.shell }),
    claudeDir,
    platform: process.platform,
    env: process.env,
    listDir: (dir) => {
      try {
        return existsSync(dir) ? readdirSync(dir) : []
      } catch {
        return []
      }
    },
  }
}

// Where Playwright keeps the browsers it downloads.
export function playwrightBrowsersDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const custom = env.PLAYWRIGHT_BROWSERS_PATH
  if (custom && custom !== '0') return custom
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright')
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'ms-playwright')
  return join(home, '.cache', 'ms-playwright')
}

export function chromiumInstalled(names: string[]): boolean {
  return names.some((n) => /^chromium(_headless_shell)?-\d+/.test(n))
}

export class Installer {
  private readonly running = new Set<InstallId>()

  constructor(private readonly d: InstallDeps) {}

  private async version(id: InstallId, cmd: string): Promise<InstallStatusItem> {
    const run = await this.d.run(cmd, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS, shell: this.d.platform === 'win32' })
    return stateFromVersionRun(id, run)
  }

  async status(): Promise<InstallStatusItem[]> {
    const d = this.d
    const [claude, opencode, uv, nodejs, codegraph] = await Promise.all([
      this.version('claude', 'claude'),
      this.version('opencode', 'opencode'),
      this.version('uv', 'uv'),
      this.version('nodejs', 'node'),
      this.version('codegraph', 'codegraph'),
    ])
    const sp = detectSuperpowers(d.claudeDir)
    const playwright: InstallStatusItem = {
      id: 'playwright',
      state: chromiumInstalled(d.listDir(playwrightBrowsersDir(d.env, d.platform, homedir()))) ? 'installed' : 'missing',
    }
    const superpowers: InstallStatusItem = { id: 'superpowers', state: sp.installed ? 'installed' : 'missing', ...(sp.version ? { version: sp.version } : {}) }
    // The speech model is cached by the app window, so core cannot see it: the window fills this one in.
    const dictation: InstallStatusItem = { id: 'dictation', state: 'unknown' }
    const byId: Record<InstallId, InstallStatusItem> = { claude, opencode, uv, nodejs, hindsight: hindsightFromUv(uv), codegraph, playwright, superpowers, dictation }
    return INSTALL_IDS.map((id) => {
      const binary = PROGRAM_BINARY[id]
      const found = binary ? resolveCli(binary, d.env, d.platform)?.file : id === 'playwright' ? playwrightBrowsersDir(d.env, d.platform, homedir()) : id === 'superpowers' ? sp.path : undefined
      return found && byId[id].state === 'installed' ? { ...byId[id], path: found } : byId[id]
    })
  }

  // Runs the install for one tool. Only ever called from the confirm flow. Never throws: the result says what went wrong.
  async run(id: InstallId): Promise<InstallResult> {
    const attempts = installAttempts(id, this.d.platform)
    if (attempts.length === 0) return { id, ok: false, error: 'Foreman does not run an install for this one' }
    if (this.running.has(id)) return { id, ok: false, error: 'An install for this is already running' }
    this.running.add(id)
    try {
      let last = ''
      for (const a of attempts) {
        const r = await this.d.run(a.file, a.args, { timeoutMs: INSTALL_TIMEOUT_MS, shell: this.d.platform === 'win32' })
        if (r.code === 0) return { id, ok: true }
        last = lastErrorLine(`${r.stderr}\n${r.stdout}`)
      }
      return { id, ok: false, error: last }
    } finally {
      this.running.delete(id)
    }
  }
}
