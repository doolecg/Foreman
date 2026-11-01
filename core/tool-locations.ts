import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { InstallId } from '../shared/install'

// The command each program is run by; the other install rows are not programs on PATH.
export const PROGRAM_BINARY: Partial<Record<InstallId, string>> = { claude: 'claude', opencode: 'opencode', uv: 'uv', nodejs: 'node' }

export interface LocationDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  exists: (p: string) => boolean
  listDir: (dir: string) => string[]
}

export function systemLocationDeps(): LocationDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    exists: existsSync,
    listDir: (dir) => {
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    },
  }
}

// The folders these programs install themselves into, apart from PATH: the installer defaults of each tool and of npm, pip, cargo, bun and the package managers.
export function defaultDirs(d: LocationDeps): string[] {
  const p = d.platform === 'win32' ? win32 : posix
  const h = d.home
  const dirs =
    d.platform === 'win32'
      ? [
          p.join(h, '.local', 'bin'),
          p.join(d.env.APPDATA || p.join(h, 'AppData', 'Roaming'), 'npm'),
          p.join(d.env.LOCALAPPDATA || p.join(h, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'),
          p.join(d.env.LOCALAPPDATA || p.join(h, 'AppData', 'Local'), 'Programs'),
          p.join(d.env.ProgramFiles || 'C:/Program Files', 'nodejs'),
          p.join(h, 'scoop', 'shims'),
          p.join(h, '.cargo', 'bin'),
          p.join(h, '.bun', 'bin'),
          p.join(h, '.opencode', 'bin'),
          p.join(h, '.claude', 'local'),
        ]
      : [
          p.join(h, '.local', 'bin'),
          '/usr/local/bin',
          '/opt/homebrew/bin',
          '/usr/bin',
          p.join(h, '.cargo', 'bin'),
          p.join(h, '.bun', 'bin'),
          p.join(h, '.opencode', 'bin'),
          p.join(h, '.claude', 'local'),
          p.join(h, '.npm-global', 'bin'),
          p.join(h, '.volta', 'bin'),
        ]
  // nvm keeps one folder per Node version.
  const nvm = p.join(h, '.nvm', 'versions', 'node')
  for (const v of d.listDir(nvm)) dirs.push(p.join(nvm, v, 'bin'))
  return dirs
}

const exts = (platform: NodeJS.Platform) => (platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''])

// The full path of the program in one of the default places, or null.
export function findInDefaults(id: InstallId, d: LocationDeps = systemLocationDeps()): string | null {
  const name = PROGRAM_BINARY[id]
  if (!name) return null
  const p = d.platform === 'win32' ? win32 : posix
  for (const dir of defaultDirs(d)) for (const e of exts(d.platform)) if (d.exists(p.join(dir, name + e))) return p.join(dir, name + e)
  return null
}

// The PATH Foreman started with, kept so a path that is later forgotten leaves nothing behind.
const basePath = new WeakMap<NodeJS.ProcessEnv, string>()

// Puts the folder of every program the owner pointed Foreman at in front of PATH, for Foreman and everything it starts.
// With no paths the environment is left alone.
export function applyToolPaths(paths: Record<string, string>, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): void {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  if (!basePath.has(env)) {
    if (Object.keys(paths).length === 0) return
    basePath.set(env, env[key] ?? '')
  }
  const p = platform === 'win32' ? win32 : posix
  const dirs = [...new Set(Object.values(paths).map((f) => p.dirname(f)))]
  env[key] = [...dirs, basePath.get(env)!].filter(Boolean).join(platform === 'win32' ? ';' : ':')
}
