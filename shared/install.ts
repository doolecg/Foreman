// The optional (and required) tools Foreman can use, how to tell if each is there, and the command that installs it.
// Pure data and rules; core/install.ts runs the commands and renderer/ shows them.

export const INSTALL_IDS = ['claude', 'opencode', 'uv', 'nodejs', 'hindsight', 'codegraph', 'playwright', 'superpowers', 'dictation'] as const
export type InstallId = (typeof INSTALL_IDS)[number]

export type InstallState = 'installed' | 'missing' | 'unknown'

export interface InstallStatusItem {
  id: InstallId
  state: InstallState
  version?: string
  // Where it is: the program on PATH, the pack folder, the browsers folder.
  path?: string
  // The owner pointed Foreman at this path (Locate, or found in the default places).
  custom?: boolean
}

export type InstallResult = { id: InstallId; ok: true } | { id: InstallId; ok: false; error: string }

export interface InstallCommand {
  file: string
  args: string[]
}

export interface InstallItem {
  id: InstallId
  name: string
  enables: string
  optional: boolean
  // Offered with a checkbox in the first-start setup.
  firstStart: boolean
  // True when core can run it. Dictation runs in the app window; Hindsight has no install of its own; Claude Code's route is not confirmed.
  runnable: boolean
  // Shown as the detail line when there is no command to run.
  note?: string
}

export const INSTALL_ITEMS: InstallItem[] = [
  { id: 'claude', name: 'Claude Code', enables: 'Claude Code terminals and chat; Foreman needs it.', optional: false, firstStart: false, runnable: false, note: 'Install route not confirmed.' },
  { id: 'opencode', name: 'OpenCode CLI', enables: 'OpenCode terminals and chat.', optional: true, firstStart: true, runnable: true },
  { id: 'uv', name: 'uv', enables: 'The Hindsight memory server and the Git MCP server.', optional: true, firstStart: true, runnable: true },
  { id: 'nodejs', name: 'Node.js', enables: 'npx, which runs the Playwright MCP server.', optional: true, firstStart: false, runnable: true },
  { id: 'hindsight', name: 'Hindsight memory server', enables: 'Shared memory across sessions, run through uv and turned on with the Memory setting.', optional: true, firstStart: false, runnable: false, note: 'Needs uv; there is nothing separate to install.' },
  { id: 'codegraph', name: 'CodeGraph', enables: 'A code index with symbol search, so agents find code without reading every file.', optional: true, firstStart: true, runnable: true },
  { id: 'playwright', name: 'Playwright MCP and browser', enables: 'A Chromium browser that agents can drive to open pages and test web apps.', optional: true, firstStart: true, runnable: true },
  { id: 'superpowers', name: 'Superpowers skills pack', enables: 'The Superpowers skills that presets can use.', optional: true, firstStart: true, runnable: true },
  { id: 'dictation', name: 'Dictation speech model', enables: 'The microphone button in the composer, with a model that runs on this device.', optional: true, firstStart: true, runnable: true },
]

// The one MCP server with no Install row of its own; the Install page lists it as its own row after INSTALL_ITEMS.
export const GIT_MCP_ROW_NAME = 'Git MCP'

// The names of every row on the Install page's tools list, in order.
export function toolRowNames(): string[] {
  return [...INSTALL_ITEMS.map((i) => i.name), GIT_MCP_ROW_NAME]
}

// The runtime each optional MCP server needs, as the Install row that provides it.
export const MCP_RUNTIME_INSTALL = { git: 'uv', playwright: 'nodejs', codegraph: 'codegraph' } as const satisfies Record<string, InstallId>

// Whether the Install page offers a button: dictation runs in the window, the rest need a command for this platform.
export function canRunInstall(id: InstallId, platform: string): boolean {
  return installItem(id).runnable && (id === 'dictation' || installAttempts(id, platform).length > 0)
}

export function installItem(id: InstallId): InstallItem {
  return INSTALL_ITEMS.find((i) => i.id === id)!
}

// What the first-start setup offers.
export const FIRST_START_ITEMS: InstallItem[] = INSTALL_ITEMS.filter((i) => i.firstStart)

// The rows that are programs on PATH, which can be found in their default places or pointed at.
export const PROGRAM_IDS: InstallId[] = ['claude', 'opencode', 'uv', 'nodejs', 'codegraph']

// The tool the default CLI needs is required and the other CLI is optional; rows that only work through Claude Code
// (the Superpowers pack installs through `claude plugin install`) are left out when OpenCode is the default and Claude is not installed.
export type MainCliKind = 'claude' | 'opencode'

export function installItems(mainCli: MainCliKind = 'claude', statuses?: InstallStatusItem[]): InstallItem[] {
  const claudeAbsent = mainCli === 'opencode' && toolMissing(statuses, 'claude')
  return INSTALL_ITEMS.filter((i) => !(claudeAbsent && i.id === 'superpowers')).map((i) => {
    if (i.id === 'claude') return { ...i, optional: mainCli === 'opencode' }
    if (i.id === 'opencode') return { ...i, optional: mainCli !== 'opencode' }
    return i
  })
}

export function firstStartItems(mainCli: MainCliKind = 'claude', statuses?: InstallStatusItem[]): InstallItem[] {
  return installItems(mainCli, statuses).filter((i) => i.firstStart)
}

// The setup opens once: until the flag is set, and only after settings have loaded.
export function shouldShowSetup(setupDone: boolean | undefined): boolean {
  return setupDone === false
}

// The commands tried in order until one succeeds. Empty when core runs nothing (dictation, hindsight, claude).
export function installAttempts(id: InstallId, platform: string): InstallCommand[] {
  switch (id) {
    case 'opencode':
      return [{ file: 'npm', args: ['i', '-g', '@opencode/cli'] }]
    case 'uv':
      return platform === 'win32'
        ? [
            { file: 'winget', args: ['install', '--id', 'astral-sh.uv', '-e'] },
            { file: 'pip', args: ['install', 'uv'] },
          ]
        : [{ file: 'pip', args: ['install', 'uv'] }]
    case 'nodejs':
      return platform === 'win32' ? [{ file: 'winget', args: ['install', '--id', 'OpenJS.NodeJS.LTS', '-e'] }] : []
    case 'codegraph':
      return [{ file: 'npm', args: ['i', '-g', '@colbymchenry/codegraph'] }]
    case 'playwright':
      return [{ file: 'npx', args: ['playwright', 'install', 'chromium'] }]
    case 'superpowers':
      return [{ file: 'claude', args: ['plugin', 'install', 'superpowers@claude-plugins-official'] }]
    default:
      return []
  }
}

// The text the confirm dialog shows. Claude Code shows its unconfirmed route; dictation shows what it does.
export function commandText(id: InstallId, platform: string): string {
  if (id === 'claude') return 'claude install'
  if (id === 'dictation') return 'Download the Whisper speech model (Xenova/whisper-base) and keep it on this device'
  const attempts = installAttempts(id, platform).map((c) => [c.file, ...c.args].join(' '))
  return attempts.length > 1 ? `${attempts[0]}  (if that fails: ${attempts.slice(1).join('; ')})` : (attempts[0] ?? '')
}

export interface RunLike {
  code: number | null
  stdout: string
  stderr: string
}

const VERSION_RE = /(?<![\d.])(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/
const NOT_ON_PATH = /ENOENT|not recognized|not found|No such file|cannot find the (file|path)/i

// One `tool --version` run as a status. A run that timed out or never started for another reason is unknown.
export function stateFromVersionRun(id: InstallId, run: RunLike): InstallStatusItem {
  const version = VERSION_RE.exec(run.stdout)?.[1] ?? VERSION_RE.exec(run.stderr)?.[1]
  if (run.code === 0) return { id, state: 'installed', ...(version ? { version } : {}) }
  if (run.code === null && !NOT_ON_PATH.test(run.stderr)) return { id, state: 'unknown' }
  return { id, state: 'missing' }
}

// Hindsight is ready exactly when uv is.
export function hindsightFromUv(uv: InstallStatusItem): InstallStatusItem {
  return { id: 'hindsight', state: uv.state, ...(uv.version ? { version: uv.version } : {}) }
}

export function statusLabel(s: InstallStatusItem | undefined): string {
  if (!s || s.state === 'unknown') return 'Unknown'
  if (s.state === 'missing') return 'Not installed'
  return s.version ? `Installed ${s.version}` : 'Installed'
}

// The last non-empty line of a failed install's output.
export function lastErrorLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return (lines[lines.length - 1] ?? 'The install failed').slice(0, 300)
}

// Settings sections that need a tool which is known to be missing. While the status is still loading nothing is hidden.
// The Skills section stays: it is where Superpowers is installed.
export function hiddenSections(statuses: InstallStatusItem[] | undefined): string[] {
  return toolMissing(statuses, 'uv') ? ['hindsight'] : []
}

// A feature that needs a tool is shown unless the tool is known to be missing; unknown never hides.
export function toolMissing(statuses: InstallStatusItem[] | undefined, id: InstallId): boolean {
  return statuses?.find((s) => s.id === id)?.state === 'missing'
}
