import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, parse } from 'node:path'
import type { CoreChannel, IpcApi, IpcEvents } from '../shared/ipc'
import { mergeSettings, sanitizeSettings, type Settings, type SettingsPatch } from '../shared/settings'
import type {
  BudgetConfig,
  BudgetStatus,
  Crew,
  CrewPatch,
  ExportText,
  ImportSource,
  IpcErrorCode,
  LaunchSettings,
  Preset,
  ScratchTerminal,
  ScratchStatus,
  TeamImportPreview,
  UsageQuery,
  UsageView,
  ExportFormat,
  ScratchInput,
  ScratchPatch,
  Team,
  TeamInput,
  TeamPatch,
} from '../shared/types'
import { ProjectGroups } from './groups'
import { ProjectActions } from './actions'
import { BUDGETS_KEY, BudgetMonitor, mergeBudgets, sanitizeBudgets, WINDOW_LABEL, type BudgetDecision } from './usage-budgets'
import type { KeepWarmPersisted } from './keepwarm'
import { Ops } from './ops'
import { claudeDir as claudeDirOf } from './paths'
import { applySetup, planView, setupLibraryDir } from './setup-service'
import { Installer, systemInstallDeps } from './install'
import { buildEnhancePrompt, mergeSkills, normalizeEnhanceContext, parseEnhanceReply, type EnhanceContext } from '../shared/prompt-enhance'
import { gatherEnhanceContext, recentMessages } from './enhance-context'
import { claudeEnhanceModel, type EnhanceModel } from './enhance-model'
import { installedSkills } from './installed-skills'
import { SETTINGS_SECTIONS, resetSettings } from '../shared/settings'
import { LaunchError, buildChatLaunch, buildScratchLaunch, commandLine, shellOf, validateLaunchSettings, writeLaunchFiles, SOCKET_PLACEHOLDER, TOKEN_PLACEHOLDER, type LaunchContext, type LaunchResult, type ShellKind } from './launch'
import { McpError, McpService } from './mcp'
import { listModels } from './models'
import { ProviderMonitor } from './providers'
import { exportTeams, parseTeamFile } from './team-presets'
import { applyRead, exportBundle, previewRead, readSource, type ImportDeps } from './import'
import { gitChanges, gitInfo, listIdes, openInIde } from './projecttools'
import * as repoGit from './git'
import { killAllOwn, resolveCli, runHidden } from './proc'
import { scrubLogLine } from './agents'
import { ChatHub, ChatSession, type ChatLaunchSpec, type ChatSpawn } from './claude-chat'
import { listChatFiles } from './chat-files'
import { emptyChatState, stripAnsi, type ChatOp, type ChatState } from '../shared/claude-chat'
import { PLAYGROUND_KEPT, type Store } from './store'
import { createNote, deleteNote, getNote, listNotes, updateNote } from './notes'
import { isNoteColor } from '../shared/notes'
import { JsonlTail, parseLine, transcriptPath } from './transcripts'
import { CapabilityProber, systemProbeDeps, type ProbeDeps } from './capabilities'
import { ClaudeAgents, sameFolder } from './claude-agents'
import { createGraphPusher } from './graph-push'
import { hooksConfig, type ModsPaths } from './claude-events'
import { packStatus, resetPack } from './engineering'
import { installKit } from './orchestration-kit'
import { listTasks, readTask, readTaskPlan, watchTasks } from './task-stage'
import { applyToolPaths, findInDefaults, PROGRAM_BINARY } from './tool-locations'
import type { InstallId, InstallStatusItem } from '../shared/install'
import { buildPreamble } from '../shared/engineering'
import { openCodeDbPath } from './opencode-usage'
import { enabledMods, type CapabilityReport, type ClaudeTileState } from '../shared/mods'
import { inheritedEnv, type SessionKey, type SessionManager } from './sessions'
import { listServers } from './servers'
import { looksLikeServerStart, type TileRoot } from '../shared/servers'
import { cleanFilter, queryUsage, querySeries } from './usage-query'
import { exportView } from './usage-export'
import { isColdTurn } from './usage'
import { randomUUID } from 'node:crypto'
import { DocsServer, resolveDocFile } from './docs-server'
import { readProjectImage } from './image-file'
import { autoOpenPath, isDocFile, relativeInProject } from '../shared/docs'
import { saveScreenshot } from './screenshots'
import { EXIT, type CliRequest, type CliResult, type Identity } from './cli-server'

type Handlers = { [C in CoreChannel]: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<Awaited<ReturnType<IpcApi[C]>>> }

type PushEvents = { [E in keyof IpcEvents]: [IpcEvents[E]] }

type Group<P extends string> = Pick<Handlers, Extract<CoreChannel, `${P}:${string}`>>

// What Foreman needs from the CLI server (CliServer satisfies it).
export interface CliAccess {
  readonly address: string
  listen(): Promise<string>
  issueToken(id: number): string
  revokeToken(id: number): void
  close(): Promise<void>
}

export interface Scheduler {
  every(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

const realScheduler: Scheduler = {
  every: (fn, ms) => {
    const h = setInterval(fn, ms)
    h.unref?.()
    return h
  },
  cancel: (h) => clearInterval(h as ReturnType<typeof setInterval>),
}

export interface LaunchOptions {
  platform?: NodeJS.Platform
  // <userData>/launch (settings files) and <userData>/roles (preset guidance files).
  launchDir?: string
  rolesDir?: string
  writer?: LaunchWriter
  // Folder holding the `foreman` wrapper; put on a tile's PATH when it has a CLI token.
  cliDir?: string
  // The binary the wrapper runs the CLI with (FOREMAN_NODE).
  foremanNode?: string
  baseEnv?: NodeJS.ProcessEnv
  supported?: ReadonlySet<string>
}

export interface LaunchWriter {
  mkdir(dir: string): void
  writeFile(path: string, content: string): void
}

export interface ForemanOptions {
  store: Store
  sessions: SessionManager
  pluginDir: string
  // Where backups are written (the app passes <userData>/backups); the default is a folder under the temp dir.
  backupDir?: string
  // Where the Claude Code hooks write and which script they run; absent turns mods off.
  hooks?: ModsPaths
  // plugin/mods in the repo (dev) or in resources (packaged): one folder per native mod.
  modPluginsDir?: string
  // <userData>/engineering: the editable copy of the Engineering and Factory skill packs (core/engineering.ts); absent turns both modes off.
  engineeringDir?: string
  // The CLI probe (tests pass a fake); the real one runs `claude --version` and `opencode --version`.
  capabilityProbe?: ProbeDeps
  now?: () => number
  transcriptFile?: (cwd: string, sessionId: string) => string
  launch?: LaunchOptions
  // Each is built from the store when not given.
  cliServer?: (target: CliTarget) => CliAccess
  scheduler?: Scheduler
  // The model that rewrites prompts (Enhance prompt); Claude Haiku when not given.
  enhanceModel?: EnhanceModel
  mcp?: McpService
  // Plan limits and provider usage; real pollers when not given.
  providers?: ProviderMonitor
  // File pickers (the app supplies Electron's); without them `usage:export` and `data:exportFile` refuse.
  fileDialogs?: FileDialogs
  // Where Operant 2.8.2 kept its data and the clock/files import reads with (tests).
  importDeps?: ImportDeps
  // How a Chat view tile starts Claude Code (tests pass a fake child).
  chatSpawn?: ChatSpawn
  // The embedded browser's MCP URL, or null while it is not running. Used when Settings > Browser > AI control is on.
  browserMcp?: () => string | null
  // Called after a project is deleted (main clears that project's browser partition).
  onCrewDeleted?: (crewId: number) => void
  // Shows an address in the project's browser tile (opens the tile; reloads a tab already on that address).
  openInBrowser?: (crewId: number, url: string) => Promise<void>
}

export interface FileDialogs {
  save(suggestedName: string, filter: { name: string; extensions: string[] }): Promise<string | null>
  open(filter: { name: string; extensions: string[] }): Promise<string | null>
}

// What the CLI server asks of Foreman: who a token belongs to (a tile's project) and the memory commands.
export interface CliTarget {
  identify(tileId: number): Identity | null
  run(who: Identity, req: CliRequest): Promise<CliResult>
}

const HOUR = 60 * 60 * 1000
// Transcripts are polled rather than watched: fs.watch is unreliable across platforms for appends.
const USAGE_POLL_MS = 2_000
const PROVIDER_TICK_MS = 30_000

// A running Claude tile's transcript, followed so its spend counts.
interface ScratchFeed {
  tail: JsonlTail
  sessionId: string
  prevContext: number | null
  current: { messageId: string; toolUse: boolean } | null
  currentContext: number
}

function shellKind(file: string, platform: NodeJS.Platform): ShellKind {
  if (!file) return platform === 'win32' ? 'powershell' : 'sh'
  const base = (file.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  if (base === 'cmd') return 'cmd'
  return base === 'pwsh' || base === 'powershell' ? 'powershell' : 'sh'
}

// A refusal the dashboard can show: a code to branch on and a message fit for the user.
export class ForemanError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ForemanError'
  }
}

const bad = (message: string) => new ForemanError('BAD_ARGS', message)
const notFound = (message: string) => new ForemanError('NOT_FOUND', message)
const conflict = (message: string) => new ForemanError('CONFLICT', message)

// Every error a handler can throw, as a code and a message. Programming errors stay INTERNAL.
export function ipcErrorOf(err: unknown): { code: IpcErrorCode; message: string } {
  if (err instanceof ForemanError) return { code: err.code, message: err.message }
  if (err instanceof LaunchError) return { code: 'BAD_ARGS', message: err.message }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError) return { code: 'INTERNAL', message }
  if (/UNIQUE constraint failed/i.test(message)) return { code: 'CONFLICT', message: 'That name is already in use' }
  if (/not found/i.test(message)) return { code: 'NOT_FOUND', message }
  if (/already|cycle|busy/i.test(message)) return { code: 'CONFLICT', message }
  return { code: 'BAD_ARGS', message }
}

const toForemanError = (err: unknown): ForemanError => {
  if (err instanceof ForemanError) return err
  const { code, message } = ipcErrorOf(err)
  return new ForemanError(code, message)
}

const NAME_MAX = 80
const TILE_LAYOUT_MAX = 100_000
const AGENTS = new Set<string>(['claude', 'codex', 'shell', 'opencode'])

function cleanName(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${what} cannot be empty`)
  const t = v.trim()
  if (t.length > NAME_MAX) throw bad(`${what} is longer than ${NAME_MAX} characters`)
  return t
}

const THREAD_TITLE_MAX = 60

// The first non-empty line of a message, cut to THREAD_TITLE_MAX; null when there is no text.
function threadTitle(text: string): string | null {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? ''
  if (!line) return null
  return line.length > THREAD_TITLE_MAX ? `${line.slice(0, THREAD_TITLE_MAX - 1).trimEnd()}…` : line
}

// Everything the dashboard can ask for or be told about, independent of Electron.
export class Foreman extends EventEmitter<PushEvents> {
  readonly handlers: Handlers
  readonly budgets: BudgetMonitor
  private readonly ops: Ops
  readonly mcp: McpService
  readonly providers: ProviderMonitor
  private readonly store: Store
  private readonly sessions: SessionManager
  private readonly groups: ProjectGroups
  private readonly actions: ProjectActions
  private readonly pluginDir: string
  private readonly now: () => number
  private readonly transcriptFile: (cwd: string, sessionId: string) => string
  private readonly launch: LaunchOptions
  private readonly hookPaths: ModsPaths | null
  private readonly claudeAgents: ClaudeAgents | null
  // At most ~4 graph pushes a second per project, however many hook events arrive.
  private readonly graphPusher = createGraphPusher({ intervalMs: 250, send: (project) => this.pushGraph(project) })
  private readonly modPluginsDir: string | null
  private readonly engineeringDir: string | null
  // Per project, started when the first stage list is asked for: reports engineering:tasks when its task folders change.
  private readonly taskWatchers = new Map<number, () => void>()
  private readonly prober: CapabilityProber
  private readonly installer = new Installer(systemInstallDeps(claudeDirOf()))
  private readonly cli: CliAccess | null
  private readonly scheduler: Scheduler
  private readonly timers: unknown[] = []
  // The longest a quit waits on any one step (the CLI socket, killing processes).
  shutdownStepMs = 3000
  // Scratch terminals: transcript followers and the sessions Foreman opened.
  private readonly scratchFeeds = new Map<number, ScratchFeed>()
  // The last turn phase each tile reported, from the Chat view's ops and from the Terminal view's hooks.
  private readonly chatPhase = new Map<number, string>()
  private readonly modsPhase = new Map<number, string>()
  // Chat view tiles: one Claude Code stream-json process each (claude-chat.ts).
  readonly chat: ChatHub
  // Per tile: the pending 'servers:changed' after its output looked like a server starting.
  private readonly serverHints = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly chatSpawn: ChatSpawn | undefined
  private readonly browserMcp: (() => string | null) | undefined
  private readonly onCrewDeleted: ((crewId: number) => void) | undefined
  private readonly openInBrowser: ((crewId: number, url: string) => Promise<void>) | undefined
  // Serves project documents and presented plans to the browser tile over loopback.
  private readonly docs: DocsServer
  // Chat items already opened in the browser (tool or plan ids), so a later update of the item opens nothing again.
  private readonly docsOpened = new Set<string>()
  // Tiles switching between the Chat and Terminal views (their end is not a closed session).
  private readonly switching = new Set<number>()
  private settings: Settings
  private budgetConfig: BudgetConfig
  private readonly fileDialogs: FileDialogs | undefined
  private readonly importDeps: ImportDeps
  private pendingTeamImport: string | null = null

  constructor(opts: ForemanOptions) {
    super()
    const { store, sessions } = opts
    this.store = store
    this.sessions = sessions
    this.groups = new ProjectGroups(store.db)
    this.actions = new ProjectActions(store.db)
    this.pluginDir = opts.pluginDir
    this.now = opts.now ?? Date.now
    this.transcriptFile = opts.transcriptFile ?? ((cwd, id) => transcriptPath(cwd, id))
    this.launch = opts.launch ?? {}
    this.hookPaths = opts.hooks ?? null
    this.modPluginsDir = opts.modPluginsDir ?? null
    this.engineeringDir = opts.engineeringDir ?? null
    this.claudeAgents = opts.hooks
      ? new ClaudeAgents({
          eventsDir: opts.hooks.eventsDir,
          now: this.now,
          emit: (state) => {
            this.noteTurn(this.modsPhase, state.tileId, state.session.phase)
            this.emit('claudeTile:state', state)
          },
          onGraph: (project) => this.graphPusher.push(project),
        })
      : null
    applyToolPaths(this.toolPaths())
    this.prober = new CapabilityProber(opts.capabilityProbe ?? systemProbeDeps(openCodeDbPath()))
    this.scheduler = opts.scheduler ?? realScheduler
    this.settings = sanitizeSettings(store.getJson('settings'))
    this.budgetConfig = sanitizeBudgets(store.getJson(BUDGETS_KEY))
    this.fileDialogs = opts.fileDialogs
    this.importDeps = opts.importDeps ?? {}
    this.chatSpawn = opts.chatSpawn
    this.browserMcp = opts.browserMcp
    this.onCrewDeleted = opts.onCrewDeleted
    this.openInBrowser = opts.openInBrowser
    this.docs = new DocsServer({ folderOf: (crewId) => this.store.getCrew(crewId)?.folder ?? null })
    this.chat = new ChatHub({
      push: (scratchId, ops) => {
        this.openChatDocs(scratchId, ops)
        for (const op of ops) if (op.op === 'meta' && op.patch.turn) this.noteTurn(this.chatPhase, scratchId, op.patch.turn.phase)
        this.emit('chat:ops', { scratchId, ops })
      },
    })

    this.providers =
      opts.providers ??
      new ProviderMonitor({
        store,
        now: this.now,
        planEnabled: () => this.settings.claudePlanUsage,
        onAlert: (a) => this.log('provider', `${a.providerId === 'claude' ? 'Claude plan' : a.providerId}: ${a.windowId} is at ${Math.floor(a.usedPct)}% (alert at ${a.thresholdPct}%)`),
      })
    this.budgets = new BudgetMonitor({
      now: this.now,
      config: () => this.budgetConfig,
      globalCaps: () => ({ fiveHour: this.settings.fiveHourBudgetUsd, day: this.settings.dailyBudgetUsd, week: this.settings.weeklyBudgetUsd }),
      warnPct: () => this.settings.tokens.capWarnPct,
      crewIds: () => store.listCrews().map((c) => c.id),
      projectSpend: (crewId, since) => store.spendSince(since, crewId),
      globalSpend: (since) => store.spendSince(since),
    })
    this.enhanceModel = opts.enhanceModel ?? claudeEnhanceModel(opts.launch?.supported)
    this.ops = new Ops({
      store,
      settings: () => this.settings,
      saveSettings: (next) => this.saveSettings(next),
      backupDir: opts.backupDir ?? join(tmpdir(), 'foreman', 'backups'),
      claudeDir: claudeDirOf(),
      now: this.now,
      log: (kind, message) => this.log(kind, message),
    })
    this.mcp =
      opts.mcp ??
      new McpService({
        log: (message) => this.log('mcp', message),
        written: {
          get: () => {
            const v = this.store.getJson('mcp.written')
            return Array.isArray(v) ? v.map(String) : []
          },
          set: (keys) => this.store.setJson('mcp.written', keys),
        },
      })
    this.cli = opts.cliServer?.({ identify: (id) => this.identify(id), run: (who, req) => this.runCli(who, req) }) ?? null
    this.applySettings()

    sessions.on('data', (key, data) => {
      const id = this.scratchId(key)
      if (id != null) {
        this.emit('scratch:data', { scratchId: id, data })
        this.hintServers(id, data)
      }
    })
    sessions.on('exit', (key, exitCode) => {
      const id = this.scratchId(key)
      if (id != null) this.onScratchExit(id, exitCode)
    })

    const all: Handlers = {
      ...this.crewHandlers(),
      ...this.groupHandlers(),
      ...this.actionHandlers(),
      ...this.presetHandlers(),
      ...this.teamHandlers(),
      ...this.setupHandlers(),
      ...this.modelHandlers(),
      ...this.tileHandlers(),
      ...this.scratchHandlers(),
      ...this.notesHandlers(),
      ...this.chatHandlers(),
      ...this.usageHandlers(),
      ...this.moveHandlers(),
      ...this.miscHandlers(),
      ...this.mcpHandlers(),
      ...this.capabilityHandlers(),
      ...this.engineeringHandlers(),
      ...this.opsHandlers(),
      ...this.installHandlers(),
      ...this.toolsHandlers(),
    }
    // Every refusal leaves core as a ForemanError with a code.
    const wrapped: Record<string, (...args: unknown[]) => unknown> = {}
    for (const [channel, fn] of Object.entries(all) as Array<[string, (...args: unknown[]) => unknown]>) {
      wrapped[channel] = (...args) => {
        try {
          const result = fn(...args)
          return result instanceof Promise ? result.catch((err: unknown) => Promise.reject(toForemanError(err))) : result
        } catch (err) {
          throw toForemanError(err)
        }
      }
    }
    this.handlers = wrapped as unknown as Handlers
  }

  // Handler groups

  private requireCrew(crewId: number): Crew {
    const crew = typeof crewId === 'number' ? this.store.getCrew(crewId) : null
    if (!crew) throw notFound(`Project ${String(crewId)} not found`)
    return crew
  }

  // Opens a project's .html or .md file in its browser tile. The path is checked against the project folder.
  private async openDocument(crewId: number, path: string): Promise<void> {
    const crew = this.requireCrew(crewId)
    const rel = typeof path === 'string' && isDocFile(path) ? relativeInProject(crew.folder, path) : null
    if (!rel && typeof path === 'string' && isDocFile(path) && isAbsolute(path)) {
      // A document Claude wrote outside the project (another folder it was told to use).
      if (!this.openInBrowser) throw bad('The browser is not available')
      const url = await this.docs.urlForLooseFile(path)
      if (!url) throw notFound(`${path} was not found`)
      return void (await this.openInBrowser(crewId, url))
    }
    if (!rel) throw bad('Only an .html or .md file can be opened in the browser')
    if (!resolveDocFile(crew.folder, rel.split('/'))) throw notFound(`${rel} not found in the project`)
    if (!this.openInBrowser) throw bad('The browser is not available')
    await this.openInBrowser(crewId, await this.docs.urlFor(crewId, rel))
  }

  // Settings > Browser > Open documents: a new doc file Claude wrote (a Write that created it in a docs, plans, specs,
  // artifacts or design folder) and every plan it presents open in the project's browser tile, once each.
  private openChatDocs(scratchId: number, ops: ChatOp[]): void {
    if (!this.openInBrowser || !this.settings.browser.autoOpenDocs) return
    for (const op of ops) {
      if (op.op !== 'upsert' || this.docsOpened.has(op.item.id)) continue
      const it = op.item
      let job: ((crewId: number) => Promise<void>) | null = null
      if (it.kind === 'plan' && it.plan.trim()) {
        const plan = it.plan
        job = async (crewId) => void (await this.openInBrowser?.(crewId, await this.docs.urlForMemory('Plan', plan)))
      } else if (it.kind === 'tool' && it.name === 'Write' && it.status === 'done' && it.diff?.created && /^File created successfully/i.test(it.result?.text ?? '')) {
        const file = it.diff.path
        job = async (crewId) => {
          const folder = this.store.getCrew(crewId)?.folder
          const rel = folder ? autoOpenPath(folder, file, true) : null
          if (rel && resolveDocFile(folder!, rel.split('/'))) await this.openInBrowser?.(crewId, await this.docs.urlFor(crewId, rel))
        }
      }
      const crewId = job ? this.store.getScratch(scratchId)?.crewId : undefined
      if (!job || crewId === undefined) continue
      if (this.docsOpened.size > 500) this.docsOpened.clear()
      this.docsOpened.add(it.id)
      void job(crewId).catch(() => undefined)
    }
  }

  private requireScratch(scratchId: number): ScratchTerminal {
    const scratch = typeof scratchId === 'number' ? this.store.getScratch(scratchId) : null
    if (!scratch) throw notFound(`Scratch terminal ${String(scratchId)} not found`)
    return scratch
  }

  private requirePreset(presetId: number): Preset {
    const preset = typeof presetId === 'number' ? this.store.getPreset(presetId) : null
    if (!preset) throw notFound(`Preset ${String(presetId)} not found`)
    return preset
  }

  private crewHandlers(): Group<'crews'> {
    const store = this.store
    return {
      'crews:list': () => store.listCrews(),
      'crews:create': ({ name, folder }) => {
        if (typeof folder !== 'string' || !folder.trim()) throw bad('The folder cannot be empty')
        const crew = store.createCrew(cleanName(name, 'The project name'), folder.trim())
        this.log('crew', `Project ${crew.name} created`, crew.id)
        return crew
      },
      'crews:update': (crewId, patch) => {
        const crew = this.requireCrew(crewId)
        const next: CrewPatch = {}
        if (patch.name !== undefined) next.name = cleanName(patch.name, 'The project name')
        if (patch.folder !== undefined) {
          if (typeof patch.folder !== 'string' || !patch.folder.trim()) throw bad('The folder cannot be empty')
          if (patch.folder.trim() !== crew.folder && this.crewRunning(crewId) > 0) {
            throw conflict('Stop the project’s tiles before changing its folder')
          }
          next.folder = patch.folder.trim()
        }
        for (const key of ['engineering', 'factory'] as const) {
          const on = patch[key]
          if (on === undefined) continue
          if (typeof on !== 'boolean') throw bad(`The ${key} setting must be on or off`)
          next[key] = on
        }
        const updated = store.updateCrew(crewId, next)
        // Also when the folder moves with Orchestration already on: the new folder has no kit yet.
        if (updated.factory && ((next.factory && !crew.factory) || (next.folder !== undefined && next.folder !== crew.folder))) this.installOrchestrationKit(updated)
        if (next.folder !== undefined && next.folder !== crew.folder) {
          this.taskWatchers.get(crewId)?.()
          this.taskWatchers.delete(crewId)
        }
        this.log('crew', `Project ${updated.name} updated`, crewId)
        return updated
      },
      'crews:reorder': (crewIds) => {
        if (!Array.isArray(crewIds) || crewIds.some((id) => typeof id !== 'number')) throw bad('The order must be a list of project ids')
        return store.reorderCrews(crewIds)
      },
      'crews:delete': async (crewId) => {
        const crew = this.requireCrew(crewId)
        if (crew.kind === 'playground') throw conflict(PLAYGROUND_KEPT)
        const scratchIds = store.listScratch(crewId).map((s) => s.id)
        for (const id of scratchIds) {
          this.sessions.stop(this.scratchKey(id))
          this.detachScratch(id)
        }
        this.taskWatchers.get(crewId)?.()
        this.taskWatchers.delete(crewId)
        store.deleteCrew(crewId)
        this.log('crew', `Project ${crew.name} deleted`)
        try {
          this.onCrewDeleted?.(crewId)
        } catch (e) {
          this.log('crew', `Browser data cleanup failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      },
    }
  }

  private actionHandlers(): Group<'actions'> {
    const actions = this.actions
    // The action's own errors are plain messages; they reach the dialog as BAD_ARGS.
    const guard = <T,>(fn: () => T): T => {
      try {
        return fn()
      } catch (e) {
        throw bad(e instanceof Error ? e.message : String(e))
      }
    }
    return {
      'actions:list': (crewId) => (this.requireCrew(crewId), actions.list(crewId)),
      'actions:save': (input) => (this.requireCrew(input.crewId), guard(() => actions.save(input))),
      'actions:delete': (actionId) => guard(() => actions.delete(actionId)),
    }
  }

  private groupHandlers(): Group<'groups'> & Group<'ide'> & Group<'git'> & Group<'docs'> {
    const store = this.store
    const groups = this.groups
    const ids = (v: unknown, what: string): number[] => {
      if (!Array.isArray(v) || v.some((id) => typeof id !== 'number')) throw bad(`${what} must be a list of ids`)
      return v
    }
    return {
      'groups:list': () => groups.list(),
      'groups:create': (name) => {
        const group = groups.create(name)
        this.log('crew', `Group ${group.name} created`)
        return group
      },
      'groups:rename': (groupId, name) => groups.rename(groupId, name),
      'groups:delete': (groupId) => {
        const group = groups.get(groupId)
        groups.delete(groupId)
        this.log('crew', `Group ${group.name} removed; its projects are back in the list`)
      },
      'groups:collapse': (groupId, collapsed) => groups.setCollapsed(groupId, collapsed === true),
      'groups:reorder': (groupIds) => groups.reorder(ids(groupIds, 'The order')),
      'groups:move': (crewId, groupId, beforeCrewId) => {
        this.requireCrew(crewId)
        if (groupId !== null && typeof groupId !== 'number') throw bad('The group must be an id or null')
        store.transaction(() => groups.move(crewId, groupId, typeof beforeCrewId === 'number' ? beforeCrewId : undefined))
        return store.listCrews()
      },
      'ide:list': () => listIdes(this.settings.ide.custom),
      'docs:open': (crewId, path) => this.openDocument(crewId, path),
      'docs:readImage': (crewId, path) => {
        try {
          return readProjectImage(this.requireCrew(crewId).folder, String(path))
        } catch (err) {
          throw err instanceof ForemanError ? err : bad(err instanceof Error ? err.message : 'Could not read the image')
        }
      },
      'ide:open': (crewId, ide) => openInIde(this.requireCrew(crewId).folder, ide ?? this.settings.ide.default, this.settings.ide.custom),
      'git:changes': (crewId) => gitChanges(this.requireCrew(crewId).folder),
      'git:info': (crewId) => gitInfo(this.requireCrew(crewId).folder),
      'git:status': (id) => repoGit.gitStatus(this.requireCrew(id).folder),
      'git:diff': (id, req) => repoGit.gitDiff(this.requireCrew(id).folder, req),
      'git:stage': (id, paths) => repoGit.gitStage(this.requireCrew(id).folder, paths),
      'git:unstage': (id, paths) => repoGit.gitUnstage(this.requireCrew(id).folder, paths),
      'git:discard': (id, paths) => repoGit.gitDiscard(this.requireCrew(id).folder, paths),
      'git:stageHunk': (id, ref, stage) => repoGit.gitStageHunk(this.requireCrew(id).folder, ref, stage === true),
      'git:commit': (id, message, amend) => repoGit.gitCommit(this.requireCrew(id).folder, message, amend === true),
      'git:lastMessage': (id) => repoGit.gitLastMessage(this.requireCrew(id).folder),
      'git:log': (id, limit, skip) => repoGit.gitLog(this.requireCrew(id).folder, limit, skip),
      'git:commitDetails': (id, hash) => repoGit.gitCommitDetails(this.requireCrew(id).folder, hash),
      'git:branches': (id) => repoGit.gitBranches(this.requireCrew(id).folder),
      'git:checkout': (id, branch) => repoGit.gitCheckout(this.requireCrew(id).folder, branch),
      'git:createBranch': (id, name) => repoGit.gitCreateBranch(this.requireCrew(id).folder, name),
      'git:fetch': (id) => repoGit.gitFetch(this.requireCrew(id).folder),
      'git:pull': (id) => repoGit.gitPull(this.requireCrew(id).folder),
      'git:push': (id) => repoGit.gitPush(this.requireCrew(id).folder),
    }
  }

  private presetHandlers(): Group<'presets'> {
    const store = this.store
    const checkPreset = (p: Partial<LaunchSettings> & { name?: unknown; roleText?: unknown; mcpServers?: unknown }): void => {
      validateLaunchSettings(p)
      if (p.roleText !== undefined && p.roleText !== null && typeof p.roleText !== 'string') throw bad('Preset guidance must be text')
      if (typeof p.roleText === 'string' && p.roleText.length > 20_000) throw bad('Preset guidance is longer than 20000 characters')
      if (p.mcpServers !== undefined && (!Array.isArray(p.mcpServers) || p.mcpServers.length > 100 || p.mcpServers.some((n) => typeof n !== 'string' || !/^[A-Za-z0-9_. :-]{1,100}$/.test(n)))) {
        throw bad('MCP servers must be a list of server names')
      }
    }
    return {
      'presets:list': () => store.listPresets(),
      'presets:export': (presetId) => this.ops.presetExport(presetId),
      'presets:importPreview': (text) => this.ops.presetPreview(text),
      'presets:import': (text) => this.ops.presetImport(text),
      'presets:create': (input) => {
        checkPreset(input)
        if (!input.permissionMode) throw bad('A preset needs a permission mode')
        const preset = store.createPreset({ ...input, name: cleanName(input.name, 'The preset name') })
        this.log('preset', `Preset ${preset.name} created`)
        return preset
      },
      'presets:update': (presetId, patch) => {
        const before = this.requirePreset(presetId)
        checkPreset({ ...patch, agent: patch.agent ?? before.agent })
        const next = { ...patch } as typeof patch
        if (patch.name !== undefined) next.name = cleanName(patch.name, 'The preset name')
        const preset = store.updatePreset(presetId, next)
        this.log('preset', `Preset ${preset.name} updated`)
        return preset
      },
      'presets:duplicate': (presetId, name) => {
        const src = this.requirePreset(presetId)
        const copy = store.duplicatePreset(presetId, name === undefined ? undefined : cleanName(name, 'The preset name'))
        this.log('preset', `Preset ${src.name} duplicated as ${copy.name}`)
        return copy
      },
      'presets:delete': (presetId) => {
        const preset = this.requirePreset(presetId)
        store.deletePreset(presetId)
        this.log('preset', `Preset ${preset.name} deleted`)
      },
      'presets:reset': (presetId) => {
        const before = this.requirePreset(presetId)
        if (before.builtin == null) throw bad('Only built-in presets can be reset')
        const preset = store.resetPreset(presetId)
        this.log('preset', `Preset ${preset.name} reset to its shipped values`)
        return preset
      },
      'presets:restoreBuiltins': () => {
        const added = store.restoreBuiltins()
        if (added.length) this.log('preset', `Restored built-in presets: ${added.map((p) => p.name).join(', ')}`)
        return added
      },
    }
  }

  // Start new project: the catalog is read from the .claude/library folder.
  private setupHandlers(): Group<'setup'> {
    const lib = () => setupLibraryDir(claudeDirOf())
    const guard = <T>(fn: () => T): T => {
      try {
        return fn()
      } catch (err) {
        throw bad(err instanceof Error ? err.message : 'Setup failed')
      }
    }
    return {
      'setup:plan': (prompt, preset) => guard(() => planView(lib(), String(prompt ?? ''), typeof preset === 'string' ? preset : undefined)),
      'setup:apply': (folder, prompt, selected, preset) => {
        if (typeof folder !== 'string' || !isAbsolute(folder) || !existsSync(folder)) throw bad('Choose an existing project folder')
        const picks = Array.isArray(selected) ? selected.filter((s) => s && typeof s.kind === 'string' && typeof s.name === 'string') : []
        return guard(() => applySetup(lib(), folder, String(prompt ?? ''), picks, new Date().toISOString().slice(0, 10), typeof preset === 'string' ? preset : undefined))
      },
    }
  }

  private teamHandlers(): Group<'teams'> {
    const store = this.store
    const requireTeam = (teamId: number) => {
      const team = typeof teamId === 'number' ? store.getTeam(teamId) : null
      if (!team) throw notFound(`Team ${String(teamId)} not found`)
      return team
    }
    const rules = (v: unknown): string => {
      if (typeof v !== 'string') throw bad('Rules must be text')
      if (v.length > 20_000) throw bad('Rules are longer than 20000 characters')
      return v
    }
    const description = (v: unknown): string => {
      if (typeof v !== 'string') throw bad('The description must be text')
      if (v.length > 500) throw bad('The description is longer than 500 characters')
      return v
    }
    return {
      'teams:list': () => store.listTeams(),
      'teams:create': (input: TeamInput) => {
        const team = store.createTeam({
          name: cleanName(input.name, 'The team name'),
          rules: input.rules === undefined ? '' : rules(input.rules),
          description: input.description === undefined ? '' : description(input.description),
        })
        this.log('team', `Team ${team.name} created`)
        return team
      },
      'teams:update': (teamId, patch: TeamPatch) => {
        requireTeam(teamId)
        const next: TeamPatch = {}
        if (patch.name !== undefined) next.name = cleanName(patch.name, 'The team name')
        if (patch.rules !== undefined) next.rules = rules(patch.rules)
        if (patch.description !== undefined) next.description = description(patch.description)
        const team = store.updateTeam(teamId, next)
        this.log('team', `Team ${team.name} updated`)
        return team
      },
      'teams:delete': (teamId) => {
        const team = requireTeam(teamId)
        if (team.builtin != null) throw bad(`${team.name} is a built-in team and cannot be deleted. Hide it instead.`)
        store.deleteTeam(teamId)
        this.log('team', `Team ${team.name} deleted`)
      },
      'teams:duplicate': (teamId, name) => {
        const src = requireTeam(teamId)
        const copy = store.duplicateTeam(teamId, name === undefined ? undefined : cleanName(name, 'The team name'))
        this.log('team', `Team ${src.name} duplicated as ${copy.name}`)
        return copy
      },
      'teams:reset': (teamId) => {
        if (requireTeam(teamId).builtin == null) throw bad('Only built-in teams can be reset')
        try {
          const team = store.resetTeam(teamId)
          this.log('team', `Team ${team.name} reset to its shipped values`)
          return team
        } catch (e) {
          throw bad(e instanceof Error ? e.message : String(e))
        }
      },
      'teams:setHidden': (teamId, hidden) => {
        const team = requireTeam(teamId)
        if (team.builtin == null) throw bad('Only built-in teams can be hidden. Delete a team of your own instead.')
        return store.setTeamHidden(teamId, hidden === true)
      },
      'teams:export': async (teamId) => {
        const teams = teamId === undefined ? store.listTeams() : [requireTeam(teamId)]
        return { saved: await this.saveExport(exportTeams(store, teams)) }
      },
      'teams:importPreview': async (): Promise<TeamImportPreview | null> => {
        const path = await this.fileDialogs?.open({ name: 'Foreman teams', extensions: ['json'] })
        if (!path) return null
        const items = parseTeamFile(store, readFileSync(path, 'utf8'))
        this.pendingTeamImport = path
        return { path, entries: items.map((i) => i.entry) }
      },
      'teams:import': (path) => {
        if (path !== this.pendingTeamImport) throw bad('Choose the file again before importing')
        const added: Team[] = parseTeamFile(store, readFileSync(path, 'utf8')).flatMap((i) => (i.input ? [store.createTeam({ ...i.input, name: store.teamNameFree(i.input.name, null) })] : []))
        this.pendingTeamImport = null
        this.log('team', `Imported ${added.length} team${added.length === 1 ? '' : 's'}`)
        return added
      },
    }
  }

  private modelHandlers(): Group<'models'> {
    return {
      'models:list': (agent, refresh) => {
        if (agent !== 'claude' && agent !== 'opencode') throw bad('agent must be claude or opencode')
        return listModels(agent, { refresh: refresh === true })
      },
    }
  }

  // Tile layout (the split tree of the terminal view), kept per project.
  private tileHandlers(): Group<'tiles'> {
    const store = this.store
    return {
      'tiles:getLayout': (crewId) => store.getTileLayout(this.requireCrew(crewId).id),
      'tiles:saveLayout': (crewId, layout) => {
        this.requireCrew(crewId)
        const text = JSON.stringify(layout ?? {})
        if (text === undefined || text.length > TILE_LAYOUT_MAX) throw bad('The tile layout is too large')
        store.setTileLayout(crewId, layout)
      },
    }
  }

  private scratchHandlers(): Group<'scratch'> {
    const store = this.store
    const check = (p: { agent?: string; model?: string; effort?: string; presetId?: number | null }, agent: string) => {
      if (p.agent !== undefined && !AGENTS.has(p.agent)) throw bad('The agent must be claude, codex, opencode or shell')
      validateLaunchSettings({ agent: agent as LaunchSettings['agent'], ...(p.model !== undefined ? { model: p.model.trim() } : {}), ...(p.effort !== undefined ? { effort: p.effort } : {}) })
      if (p.presetId != null) this.requirePreset(p.presetId)
    }
    const cwd = (v: unknown): string => {
      if (typeof v !== 'string' || !v.trim() || /[\0-\x1f\x7f]/.test(v)) throw bad('The folder is not valid')
      return v.trim()
    }
    return {
      'scratch:list': (crewId) => store.listScratch(this.requireCrew(crewId).id),
      'scratch:create': (input: ScratchInput) => {
        const crew = this.requireCrew(input.crewId)
        check(input, input.agent)
        const scratch = store.createScratch({
          crewId: crew.id,
          title: cleanName(input.title, 'The title'),
          agent: input.agent,
          model: input.model?.trim() ?? '',
          effort: input.effort ?? '',
          presetId: input.presetId ?? null,
          view: input.view === 'chat' || input.view === 'terminal' ? input.view : input.agent === 'claude' ? 'chat' : 'terminal',
          cwd: input.cwd === undefined ? crew.folder : cwd(input.cwd),
        })
        this.log('scratch', `Tile ${scratch.title} created`, crew.id)
        this.emit('scratch:changed', { crewId: crew.id, scratchId: scratch.id })
        return scratch
      },
      'scratch:update': (scratchId, patch: ScratchPatch) => {
        const cur = this.requireScratch(scratchId)
        check(patch, patch.agent ?? cur.agent)
        const scratch = store.updateScratch(scratchId, {
          ...(patch.title !== undefined ? { title: cleanName(patch.title, 'The title') } : {}),
          ...(patch.agent !== undefined ? { agent: patch.agent } : {}),
          ...(patch.model !== undefined ? { model: patch.model.trim() } : {}),
          ...(patch.effort !== undefined ? { effort: patch.effort } : {}),
          ...(patch.presetId !== undefined ? { presetId: patch.presetId } : {}),
          ...(patch.cwd !== undefined ? { cwd: cwd(patch.cwd) } : {}),
        })
        this.log('scratch', `Tile ${scratch.title} updated`, scratch.crewId)
        if (patch.title !== undefined) this.emit('scratch:changed', { crewId: scratch.crewId, scratchId })
        return scratch
      },
      'scratch:delete': (scratchId) => {
        const scratch = this.requireScratch(scratchId)
        this.sessions.stop(this.scratchKey(scratchId))
        void this.chat.drop(scratchId)
        this.detachScratch(scratchId)
        store.deleteScratch(scratchId)
        this.log('scratch', `Tile ${scratch.title} deleted`, scratch.crewId)
        this.emit('scratch:changed', { crewId: scratch.crewId, scratchId })
      },
      'scratch:start': (scratchId, resume) => {
        this.requireScratch(scratchId)
        return this.startScratch(scratchId, { resume: resume === true })
      },
      'scratch:status': (scratchId) => {
        this.requireScratch(scratchId)
        return this.scratchStatus(scratchId)
      },
      'scratch:spend': (crewId) => store.scratchSpend(this.requireCrew(crewId).id, this.now() - 24 * HOUR),
      'scratch:stop': (scratchId) => {
        this.requireScratch(scratchId)
        this.stopScratch(scratchId)
      },
      'scratch:write': (scratchId, data) => this.sessions.write(this.scratchKey(scratchId), data),
      'scratch:resize': (scratchId, cols, rows) => this.sessions.resize(this.scratchKey(scratchId), cols, rows),
      'scratch:buffer': (scratchId) => this.sessions.buffer(this.scratchKey(scratchId)),
      'scratch:setView': (scratchId, view) => this.setView(scratchId, view),
    }
  }

  private notesHandlers(): Group<'notes'> {
    const store = this.store
    return {
      'notes:list': (crewId) => listNotes(store, this.requireCrew(crewId).id),
      'notes:create': (crewId, color) => {
        const crew = this.requireCrew(crewId)
        if (!isNoteColor(color)) throw bad('The note colour is not valid')
        const note = createNote(store, crew.id, color)
        this.emit('notes:changed', { crewId: crew.id })
        return note
      },
      'notes:update': (id, patch) => {
        if (patch.color !== undefined && !isNoteColor(patch.color)) throw bad('The note colour is not valid')
        if (patch.text !== undefined && typeof patch.text !== 'string') throw bad('The note text is not valid')
        if (!getNote(store, id)) throw notFound('That note no longer exists')
        const note = updateNote(store, id, patch)
        this.emit('notes:changed', { crewId: note.crewId })
        return note
      },
      'notes:delete': (id) => {
        const crewId = deleteNote(store, id)
        if (crewId != null) this.emit('notes:changed', { crewId })
      },
    }
  }

  private usageHandlers(): Group<'usage'> & Group<'purge'> & Group<'budgets'> {
    const deps = () => ({ store: this.store, now: this.now })
    const checkView = (view: UsageView): UsageView => {
      if (!view || typeof view !== 'object') throw bad('Unknown view')
      if (view.kind === 'report') return { kind: 'report', query: { ...view.query, filter: cleanFilter(view.query?.filter) } }
      if (view.kind === 'series') return { kind: 'series', query: { ...view.query, filter: cleanFilter(view.query?.filter) } }
      throw bad('Unknown view')
    }
    const query = (q: UsageQuery): UsageQuery => ({ ...q, filter: cleanFilter(q?.filter) })
    return {
      'usage:report': (q) => queryUsage(deps(), query(q)),
      'usage:timeseries': (q) => querySeries(deps(), { ...q, filter: cleanFilter(q?.filter) }),
      'usage:exportText': (view: UsageView, format: ExportFormat) => exportView(deps(), checkView(view), format),
      'usage:export': async (view: UsageView, format: ExportFormat) => ({ saved: await this.saveExport(exportView(deps(), checkView(view), format)) }),
      'budgets:get': () => this.budgetStatus(),
      'budgets:set': (patch) => {
        this.budgetConfig = mergeBudgets(this.budgetConfig, patch)
        this.store.setJson(BUDGETS_KEY, this.budgetConfig)
        this.checkBudgets()
        return this.budgetStatus()
      },
    }
  }

  // `claude doctor` for the Chat view's /doctor: its report as plain text, colours and secrets removed.
  private async claudeDoctor(): Promise<string> {
    const cli = resolveCli('claude')
    if (!cli) throw bad('Claude Code is not on PATH')
    const r = await runHidden(cli.file, ['doctor'], { shell: cli.shell, timeoutMs: 60_000, quiet: true })
    const text = stripAnsi(`${r.stdout}${r.stderr}`).split(/\r?\n/).map(scrubLogLine).join('\n').trim()
    if (!text) throw bad('claude doctor printed nothing')
    return text.slice(0, 20_000)
  }

  // Sends the graph to every project whose folder is the one the events came from.
  private pushGraph(project: string): void {
    for (const crew of this.store.listCrews()) {
      if (crew.folder && sameFolder(crew.folder, project)) this.emit('graph:state', { crewId: crew.id, graph: this.claudeAgents?.graphFor(crew.folder) ?? null })
    }
  }

  private capabilityHandlers(): Group<'capabilities'> & Group<'claudeTile'> & Group<'claude'> & Group<'graph'> {
    return {
      'capabilities:get': (): Promise<CapabilityReport> => this.prober.get(),
      'capabilities:refresh': (): Promise<CapabilityReport> => this.prober.refresh(),
      'claude:doctor': () => this.claudeDoctor(),
      'claudeTile:get': (tileId): ClaudeTileState | null => this.claudeAgents?.get(tileId) ?? null,
      'graph:get': (crewId) => this.claudeAgents?.graphFor(this.requireCrew(crewId).folder) ?? null,
    }
  }

  private engineeringHandlers(): Group<'engineering'> {
    const status = () => ({ edited: this.engineeringDir ? packStatus(this.engineeringDir).edited : [], folder: this.engineeringDir ?? '' })
    const watched = (crewId: number) => {
      const crew = this.requireCrew(crewId)
      if (!this.taskWatchers.has(crewId)) this.taskWatchers.set(crewId, watchTasks(crew.folder, () => this.emit('engineering:tasks', { crewId })))
      return crew
    }
    const clearedAt = (crewId: number) => Number(this.store.getJson(`engineering.cleared.${crewId}`) ?? 0)
    return {
      'engineering:status': status,
      'engineering:stages': (crewId) => readTask(watched(crewId).folder, clearedAt(crewId)),
      'engineering:plan': (crewId) => readTaskPlan(watched(crewId).folder, clearedAt(crewId)),
      'engineering:tasks:list': (crewId) => listTasks(watched(crewId).folder),
      'engineering:clearTask': (crewId) => {
        this.requireCrew(crewId)
        this.store.setJson(`engineering.cleared.${crewId}`, this.now())
        this.emit('engineering:tasks', { crewId })
      },
      'engineering:reset': () => {
        if (this.engineeringDir) resetPack(this.pluginDir, this.engineeringDir, this.now())
        return status()
      },
    }
  }

  // A crew's modes as launch.ts takes them: the preamble for the appended system prompt, the pack folders to load
  // with --plugin-dir, and whether Orchestration is on. Orchestration adds no text or plugin here (its kit lives in the
  // project's .claude); `factory` still sets FOREMAN_FACTORY for the cap hook.
  private projectModes(crewId: number, install: boolean): Pick<LaunchContext, 'modePreamble' | 'packPlugins' | 'factory' | 'orchestration'> {
    const crew = this.store.getCrew(crewId)
    if (!crew || (!crew.engineering && !crew.factory)) return {}
    // Idempotent: a project opened with Orchestration on (switched on in an older run, or its kit deleted) gets the kit at tile start.
    if (crew.factory && install) this.installOrchestrationKit(crew)
    const engineeringDir = this.engineeringDir && crew.engineering ? join(this.engineeringDir, 'engineering') : null
    return {
      ...(engineeringDir ? { modePreamble: buildPreamble(crew, { engineeringDir }), packPlugins: [engineeringDir] } : {}),
      factory: crew.factory,
      orchestration: crew.factory,
    }
  }

  // Turning Orchestration on installs the kit into the project's own .claude. A failure is logged, not thrown: the toggle stays on.
  private installOrchestrationKit(crew: Crew): void {
    try {
      const r = installKit(join(this.pluginDir, 'kit'), crew.folder)
      // Silent when nothing changed, so a tile start does not add a line each time.
      if (r.created.length || r.backedUp.length || r.differing.length) {
        this.log('crew', `Orchestration kit in ${crew.name}: ${r.created.length} added, ${r.skipped.length} already there, ${r.differing.length} differ (kept as they are: ${r.differing.join(', ') || 'none'}), ${r.backedUp.length} backed up to .claude/.foreman-backup`, crew.id)
      }
    } catch (e) {
      this.log('error', `Orchestration kit for ${crew.name} failed: ${e instanceof Error ? e.message : String(e)}`, crew.id)
    }
  }

  // The native mods' plugin folders (plugin/mods/<id>) for the enabled mods, each passed to Claude Code with
  // --plugin-dir. Foreman's own Subagent Panel has no plugin. A folder that is missing is skipped with a log line.
  private modPluginDirs(): string[] {
    if (!this.modPluginsDir) return []
    const dirs: string[] = []
    for (const id of enabledMods(this.settings.mods.mods)) {
      if (id === 'subagents') continue
      const dir = join(this.modPluginsDir, id)
      if (existsSync(dir)) dirs.push(dir)
      else this.log('error', `Claude mod ${id} is not installed: ${dir} is missing`)
    }
    return dirs
  }

  private mcpHandlers(): Group<'mcp'> {
    // Refusals from the CLIs and config files reach the page as plain messages.
    const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        throw err instanceof McpError ? bad(err.message) : err
      }
    }
    const folderOf = (crewId: number | null): string | null => (crewId == null ? null : this.requireCrew(crewId).folder)
    return {
      'mcp:list': (crewId, refresh) => guard(() => (refresh ? this.mcp.list(folderOf(crewId)) : this.mcp.cached(folderOf(crewId)))),
      'mcp:add': (crewId, input) => guard(() => this.mcp.add(folderOf(crewId), input)),
      'mcp:update': (crewId, id, input) => guard(() => this.mcp.update(folderOf(crewId), id, input)),
      'mcp:setEnabled': (crewId, id, enabled) => guard(() => this.mcp.setEnabled(folderOf(crewId), id, enabled === true)),
      'mcp:remove': (crewId, id) => guard(() => this.mcp.remove(folderOf(crewId), id)),
      'mcp:optional': (crewId, refresh) => guard(() => this.mcp.optional(folderOf(crewId), refresh === true)),
      'mcp:optionalAdd': (crewId, id, targets) => guard(() => this.mcp.addOptional(folderOf(crewId), id, targets)),
      'mcp:optionalRemove': (crewId, id) => guard(() => this.mcp.removeOptional(folderOf(crewId), id)),
    }
  }

  // Prompt enhance, backup and superpowers: thin calls into Ops (core/ops.ts).
  private opsHandlers(): Group<'aux'> & Group<'backup'> & Group<'superpowers'> {
    const ops = this.ops
    return {
      'aux:enhancePrompt': (text, commands, context) => this.enhancePrompt(text, commands, context),
      'aux:enhanceContext': (scratchId) => this.enhanceContext(scratchId),
      'backup:create': (label) => ops.createBackup(label),
      'backup:list': () => ops.listBackups(),
      'backup:restore': (name, confirm) => ops.restoreBackup(name, confirm),
      'backup:delete': (name) => ops.deleteBackup(name),
      'superpowers:status': () => ops.superpowers(),
    }
  }

  private toolPaths(): Record<string, string> {
    const v = this.store.getJson('toolPaths')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {}
  }

  // Applies the owner's program paths to PATH and makes the next capability read probe again.
  private setToolPaths(paths: Record<string, string>): void {
    this.store.setJson('toolPaths', paths)
    applyToolPaths(paths)
    void this.prober.refresh().catch(() => undefined)
  }

  private async toolStatus(): Promise<InstallStatusItem[]> {
    const own = this.toolPaths()
    return (await this.installer.status()).map((s) => (own[s.id] && s.state === 'installed' ? { ...s, custom: true } : s))
  }

  private async toolItem(id: InstallId): Promise<InstallStatusItem> {
    const item = (await this.toolStatus()).find((s) => s.id === id)
    if (!item) throw notFound(`Unknown tool ${String(id)}`)
    return item
  }

  // Uses `file` for the program; when it does not run as that program the old path is put back.
  private async useToolPath(id: InstallId, file: string): Promise<InstallStatusItem> {
    // The file must be the program itself (claude.exe, not some other file in its folder).
    if (parse(file).name.toLowerCase() !== PROGRAM_BINARY[id]) throw bad(`Pick the program named ${PROGRAM_BINARY[id]}`)
    const before = this.toolPaths()
    this.setToolPaths({ ...before, [id]: file })
    const item = await this.toolItem(id)
    if (item.state !== 'installed') {
      this.setToolPaths(before)
      throw bad(`That file did not run as ${PROGRAM_BINARY[id]}. Pick the ${PROGRAM_BINARY[id]} program itself.`)
    }
    return item
  }

  private toolsHandlers(): Group<'tools'> {
    const program = (id: InstallId) => {
      if (!PROGRAM_BINARY[id]) throw bad('That one is not a program Foreman looks for')
    }
    return {
      'tools:find': async (id) => {
        program(id)
        const file = findInDefaults(id)
        return file ? this.useToolPath(id, file) : this.toolItem(id)
      },
      'tools:locate': async (id) => {
        program(id)
        const win = process.platform === 'win32'
        const file = await this.fileDialogs?.open({ name: PROGRAM_BINARY[id]!, extensions: win ? ['exe', 'cmd', 'bat'] : ['*'] })
        return file ? this.useToolPath(id, file) : null
      },
      'tools:forget': async (id) => {
        program(id)
        const { [id]: _gone, ...rest } = this.toolPaths()
        this.setToolPaths(rest)
        return this.toolItem(id)
      },
    }
  }

  private installHandlers(): Group<'install'> {
    return {
      'install:status': () => this.toolStatus(),
      'install:run': async (id) => {
        const r = await this.installer.run(id)
        // A new CLI on PATH: the next capability read must probe again.
        if (r.ok) void this.prober.refresh().catch(() => undefined)
        return r
      },
    }
  }

  private miscHandlers(): Group<'health'> & Group<'events'> & Group<'settings'> {
    const store = this.store
    return {
      'events:recent': (limit) => store.recentEvents(limit),
      'events:clear': () => void store.db.prepare('DELETE FROM events').run(),
      'settings:get': () => this.settings,
      'settings:set': (patch) => this.setSettings(patch),
      'settings:reset': (section) => {
        if (section !== undefined && !SETTINGS_SECTIONS.includes(section)) throw bad(`Unknown settings section "${String(section)}"`)
        return this.saveSettings(resetSettings(this.settings, section))
      },
    }
  }

  private async setSettings(patch: SettingsPatch): Promise<Settings> {
    return this.saveSettings(mergeSettings(this.settings, patch))
  }

  private saveSettings(next: Settings): Settings {
    this.settings = next
    this.store.setJson('settings', this.settings)
    this.applySettings()
    this.emit('settings', this.settings)
    return this.settings
  }

  private crewRunning(crewId: number): number {
    let n = 0
    for (const s of this.store.listScratch(crewId)) if (this.sessions.isRunning(this.scratchKey(s.id))) n++
    return n
  }

  private moveHandlers(): Group<'import'> & Group<'data'> & Group<'providers'> & Group<'servers'> {
    const bundleText = (): ExportText => ({
      filename: `foreman-export-${new Date(this.now()).toISOString().slice(0, 10)}.json`,
      mime: 'application/json',
      text: JSON.stringify(exportBundle(this.store, this.now()), null, 2),
    })
    return {
      'import:preview': (source) => previewRead(this.store, readSource(this.importSource(source), this.importDeps)),
      'import:apply': (source) => {
        const result = applyRead(this.store, readSource(this.importSource(source), this.importDeps))
        if (result.applied) this.log('import', `Imported ${result.projects.add} projects, ${result.presets.add} presets and ${result.usage.add} usage rows from ${result.location}`)
        return result
      },
      'import:pickFile': () => this.pickFile(),
      'data:export': () => bundleText(),
      'data:exportFile': async () => ({ saved: await this.saveExport(bundleText()) }),
      'providers:status': () => this.providers.status(),
      'providers:refresh': () => this.providers.refresh(true),
      'servers:list': () =>
        listServers(this.tileRoots(), (id) => {
          const s = this.store.getScratch(id)
          const crew = s ? this.store.getCrew(s.crewId) : null
          return s && crew ? { tileTitle: s.title, crewId: crew.id, crewName: crew.name } : null
        }),
    }
  }

  private importSource(source: ImportSource): ImportSource {
    if (source?.kind === 'legacy') {
      const dir = typeof source.dir === 'string' && source.dir.trim() ? { dir: source.dir.trim() } : {}
      const rolesDir = typeof source.rolesDir === 'string' && source.rolesDir.trim() ? { rolesDir: source.rolesDir.trim() } : {}
      return { kind: 'legacy', ...dir, ...rolesDir }
    }
    if (source?.kind === 'file' && typeof source.path === 'string' && source.path.trim()) return { kind: 'file', path: source.path.trim() }
    throw bad('Choose Operant 2.8.2 data or an export file to import')
  }

  private async pickFile(): Promise<string | null> {
    return (await this.fileDialogs?.open({ name: 'Foreman export', extensions: ['json'] })) ?? null
  }

  // Writes export text to the path the user picked; null when they cancelled.
  private async saveExport(out: ExportText): Promise<string | null> {
    if (!this.fileDialogs) throw bad('This build cannot ask where to save: use the copy or download option')
    const ext = out.filename.split('.').pop() ?? 'txt'
    const path = await this.fileDialogs.save(out.filename, { name: ext.toUpperCase(), extensions: [ext] })
    if (!path) return null
    writeFileSync(path, out.text, 'utf8')
    return path
  }

  // Budgets

  // Project budgets: warnings and a log line per decision.
  checkBudgets(): BudgetDecision[] {
    const decisions = this.budgets.check()
    for (const d of decisions) this.onBudget(d)
    return decisions
  }

  private onBudget(d: BudgetDecision): void {
    const crew = d.crewId == null ? null : this.store.getCrew(d.crewId)
    const money = `$${d.spentUsd.toFixed(2)} of $${d.capUsd.toFixed(2)}`
    const who = d.crewId == null ? 'All projects are' : `Project ${crew?.name ?? d.crewId} is`
    this.log('budget', `${who} at ${Math.floor(d.pct)}% of the ${WINDOW_LABEL[d.window]} budget (${money})`, d.crewId)
    this.emit('budget', { crewId: d.crewId, window: d.window, spentUsd: d.spentUsd, capUsd: d.capUsd, pct: d.pct })
  }

  private budgetStatus(): BudgetStatus {
    return { config: this.budgetConfig, ...this.budgets.progress() }
  }

  get currentSettings(): Settings {
    return this.settings
  }

  // Lifecycle

  // Opens the CLI socket (a failure is logged, the timers start anyway), sweeps once and starts the timers.
  async start(): Promise<void> {
    if (this.timers.length > 0) return
    if (this.cli) {
      try {
        await this.cli.listen()
      } catch (err) {
        // Without the socket tiles start from now on get no CLI environment (`foreman` exits 7).
        this.log('error', `The foreman CLI socket could not be opened (${err instanceof Error ? err.name : 'unexpected error'}). Tiles run without the foreman CLI`)
      }
    }
    this.timers.push(this.scheduler.every(() => this.pollUsage(), USAGE_POLL_MS))
    this.timers.push(this.scheduler.every(() => void this.providers.refresh().catch(() => undefined), PROVIDER_TICK_MS))
    this.checkBudgets()
  }

  stopTimers(): void {
    for (const h of this.timers.splice(0)) this.scheduler.cancel(h)
  }

  // Quit path: no more timers, every process Foreman started killed by pid, every token revoked, the socket
  // closed. No step can hold the quit for more than shutdownStepMs. Sessions are the caller's.
  async shutdown(): Promise<void> {
    this.graphPusher.dispose()
    const bounded = async (work: () => Promise<unknown> | unknown): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, this.shutdownStepMs)))
      try {
        await Promise.race([Promise.resolve().then(work).catch(() => undefined), limit])
      } finally {
        clearTimeout(timer)
      }
    }
    this.stopTimers()
    for (const stop of this.taskWatchers.values()) stop()
    this.taskWatchers.clear()
    await bounded(() => this.chat.stopAll())
    await bounded(() => this.docs.close())
    await bounded(() => killAllOwn(this.shutdownStepMs))
    for (const id of this.scratchFeeds.keys()) this.cli?.revokeToken(id)
    await bounded(() => this.cli?.close())
  }

  // Reads new transcript lines for every running Claude tile.
  pollUsage(): void {
    let rows = 0
    for (const id of [...this.scratchFeeds.keys()]) rows += this.pollScratch(id)
    if (rows > 0) this.checkBudgets()
  }

  // Activity on a tile moves its updatedAt. A message also names a tile that still has its default title ("Claude: <project>",
  // "<Role>: <project>"); a title the owner set stays.
  private touchScratch(scratchId: number, message?: string): void {
    const cur = this.store.getScratch(scratchId)
    if (!cur) return
    const crewName = this.store.getCrew(cur.crewId)?.name
    const isDefault = /^(Claude|OpenCode):/.test(cur.title) || (crewName !== undefined && cur.title.endsWith(`: ${crewName}`))
    const title = message !== undefined && isDefault ? threadTitle(message) : null
    this.store.updateScratch(scratchId, { updatedAt: this.now(), ...(title ? { title } : {}) })
    this.emit('scratch:changed', { crewId: cur.crewId, scratchId })
  }

  // A turn going from working to idle: the project's files may have changed.
  private noteTurn(phases: Map<number, string>, scratchId: number, phase: string): void {
    const prev = phases.get(scratchId)
    phases.set(scratchId, phase)
    if (prev === 'working' && phase === 'idle' && this.store.isOpen) {
      const crewId = this.store.getScratch(scratchId)?.crewId
      if (crewId !== undefined) this.emit('turn:finished', { crewId })
      this.touchScratch(scratchId)
    }
  }

  // Notices

  // Settings

  private applySettings(): void {
    const { file, args } = this.settings.shell
    this.sessions.setShell(file ? { file, args: args.split(/\s+/).filter(Boolean) } : null)
    this.sessions.setSoftPrompt(this.settings.terminal.softPrompt && this.hookPaths ? dirname(this.hookPaths.eventsDir) : null)
    if (!this.settings.mods.enabled) this.claudeAgents?.dispose()
    if (!this.settings.mods.keepWarm) this.chat?.stopAllKeepWarm()
  }

  // The hooks and status line for Claude tiles, or undefined when mods are off. Factory Mode adds its subagent cap hook
  // even then.
  private hooksConfig(factory = false): Record<string, unknown> | undefined {
    if (!this.hookPaths) return undefined
    return hooksConfig(this.hookPaths, this.settings.mods, factory) ?? undefined
  }

  // Chat view "Enhance prompt": one call to a cheap Claude model.
  private readonly enhanceModel: EnhanceModel
  // The lookups for a tile's project: git and the recent conversation. Not model calls, so they are not counted.
  private async enhanceContext(scratchId: number): Promise<EnhanceContext> {
    const folder = this.store.getCrew(this.requireScratch(scratchId).crewId)?.folder ?? null
    return gatherEnhanceContext({
      git: async () => {
        if (!folder) return null
        const r = await runHidden('git', ['status', '--porcelain=v1', '--branch'], { cwd: folder, timeoutMs: 5000, source: 'git', quiet: true }).catch(() => null)
        return r && r.code === 0 ? r.stdout : null
      },
      messages: () => recentMessages(this.chat.get(scratchId)?.snapshot().items ?? []),
      folder,
    })
  }

  private async enhancePrompt(text: string, commands: Array<{ name: string; description: string }> = [], context?: EnhanceContext): Promise<string> {
    const rough = String(text ?? '').trim()
    if (!rough) throw new Error('Write something in the box first')
    const model = this.enhanceModel
    const skills = mergeSkills(rough, installedSkills(claudeDirOf()), commands.filter((c) => c && typeof c.name === 'string').map((c) => ({ name: c.name, description: String(c.description ?? '') })))
    const prompt = buildEnhancePrompt(rough, skills, normalizeEnhanceContext(context))
    const out = parseEnhanceReply(await model(prompt))
    if (!out) throw new Error('The model returned no text, or only an answer instead of a rewrite')
    return out
  }

  // Called by the updater before an install: a snapshot of the settings, presets and teams.
  snapshotBeforeUpdate(toVersion: string): string {
    return this.ops.snapshotBeforeUpdate(toVersion)
  }

  private log(kind: string, message: string, crewId: number | null = null): void {
    this.emit('event', this.store.addEvent(kind, message, crewId))
  }

  // The CLI: a tile's token identifies its project.

  private identify(tileId: number): Identity | null {
    const tile = this.store.getScratch(tileId)
    return tile ? { crewId: tile.crewId, tileId } : null
  }

  private async runCli(who: Identity, req: CliRequest): Promise<CliResult> {
    const crew = this.store.getCrew(who.crewId)
    if (!crew) return { exit: EXIT.FORBIDDEN, error: 'forbidden' }
    const args = req.args ?? {}
    if (req.cmd === 'shot') {
      const file = typeof args.file === 'string' ? args.file : ''
      const kind = typeof args.kind === 'string' ? args.kind : undefined
      if (!file) return { exit: EXIT.USAGE, error: 'usage: foreman shot <file> [kind]' }
      let saved
      try {
        saved = saveScreenshot({ projectDir: crew.folder, kind, file, now: this.now() })
      } catch (e) {
        return { exit: EXIT.ERROR, error: e instanceof Error ? e.message : String(e) }
      }
      const session = this.chat.get(who.tileId)
      if (!session) return { exit: EXIT.OK, out: 'saved (not shown: Terminal view)' }
      const text = `Screenshot saved: ${saved.relPath}${saved.image ? '' : ' (too large to preview)'}`
      session.addNotice({ source: 'shot', tone: 'info', text, ...(saved.image ? { images: [saved.image] } : {}) })
      return { exit: EXIT.OK, out: saved.path }
    }
    return { exit: EXIT.USAGE, error: `unknown command ${req.cmd}` }
  }

  // Tiles

  private scratchKey(id: number): SessionKey {
    return `scratch:${id}`
  }

  // `plain`: the tile runs just its preset, without the project's Engineering and Factory instructions (a role started from the Factory box).
  private launchContext(crewId: number, crewFolder: string, sessionId: string, plain = false, agent = 'claude'): LaunchContext {
    const platform = this.launch.platform ?? process.platform
    const cliDir = this.launch.cliDir
    const browserUrl = this.settings.browser.aiControl ? (this.browserMcp?.() ?? null) : null
    const modes: ReturnType<Foreman['projectModes']> = plain ? {} : this.projectModes(crewId, agent === 'claude')
    return {
      platform,
      shell: shellKind(this.settings.shell.file, platform),
      crewId,
      crewFolder,
      pluginDir: this.pluginDir,
      launchDir: this.launch.launchDir ?? join(tmpdir(), 'foreman', 'launch'),
      rolesDir: this.launch.rolesDir ?? join(tmpdir(), 'foreman', 'roles'),
      sessionId,
      supported: this.launch.supported,
      foremanCli: cliDir ? join(cliDir, platform === 'win32' ? 'foreman.cmd' : 'foreman') : undefined,
      foremanNode: this.launch.foremanNode,
      defaultCacheTtl: this.settings.tokens.defaultCacheTtl,
      subagentCacheTtl: this.settings.tokens.subagentCacheTtl,
      pinClaudeVersion: this.settings.tokens.pinClaudeVersion,
      mods: this.hooksConfig(modes.factory),
      modPlugins: this.settings.mods.enabled ? this.modPluginDirs() : [],
      ...modes,
      browserMcp: browserUrl ? { url: browserUrl } : undefined,
    }
  }

  private writeFiles(launch: LaunchResult): void {
    writeLaunchFiles(
      launch.files,
      this.launch.writer ?? { mkdir: (dir) => void mkdirSync(dir, { recursive: true }), writeFile: (path, content) => writeFileSync(path, content) },
    )
  }

  // Fills the socket and token placeholders (issuing the tile's token) and puts the CLI folder on its PATH.
  // Without a CLI server or a socket the tile runs without the CLI.
  private sessionEnv(launchEnv: Record<string, string>, tileId: number): Record<string, string> {
    const wantsCli = Object.values(launchEnv).some((v) => v === SOCKET_PLACEHOLDER || v === TOKEN_PLACEHOLDER)
    const token = wantsCli && this.cli?.address ? this.cli.issueToken(tileId) : null
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(launchEnv)) {
      if (v === SOCKET_PLACEHOLDER) {
        if (token) env[k] = this.cli!.address
      } else if (v === TOKEN_PLACEHOLDER) {
        if (token) env[k] = token
      } else env[k] = v
    }
    const cliDir = this.launch.cliDir
    if (token && cliDir) {
      const base = this.launch.baseEnv ?? process.env
      const platform = this.launch.platform ?? process.platform
      const key = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
      env[key] = [cliDir, base[key]].filter(Boolean).join(platform === 'win32' ? ';' : ':')
    }
    return env
  }

  scratchStatus(scratchId: number): ScratchStatus {
    const scratch = this.store.getScratch(scratchId)
    return {
      scratchId,
      running: this.sessions.isRunning(this.scratchKey(scratchId)) || this.chat.isRunning(scratchId),
      sessionId: scratch?.sessionId ?? null,
      ...(scratch ? { view: scratch.view } : {}),
    }
  }

  // Never restarts a running session. A launch failure is logged and thrown as a ForemanError.
  startScratch(scratchId: number, opts: { resume?: boolean } = {}): ScratchStatus {
    const scratch = this.store.getScratch(scratchId)
    const key = this.scratchKey(scratchId)
    if (!scratch) throw notFound(`Scratch terminal ${scratchId} not found`)
    if (this.sessions.isRunning(key) || this.chat.isRunning(scratchId)) return this.scratchStatus(scratchId)
    const crew = this.store.getCrew(scratch.crewId)
    if (scratch.agent === 'claude' && scratch.view === 'chat') return this.startChat(scratch, opts)
    try {
      const keep = !!opts.resume && scratch.sessionId != null
      const sessionId = keep ? scratch.sessionId! : randomUUID()
      if (!keep) this.store.updateScratch(scratchId, { sessionId })
      // Claude only writes a transcript with the first message: --resume of an id it has not saved fails ("No
      // conversation found"), so a conversation without turns restarts with the same id instead.
      const resume = keep && (scratch.agent !== 'claude' || existsSync(this.transcriptFile(scratch.cwd, sessionId)))
      const row: ScratchTerminal = { ...scratch, sessionId }
      const preset = scratch.presetId != null ? this.store.getPreset(scratch.presetId) : null
      const ctx = this.launchContext(scratch.crewId, crew?.folder ?? scratch.cwd, sessionId, scratch.presetId != null, scratch.agent)
      const launch = buildScratchLaunch(row, ctx, { preset, resume })
      this.writeFiles(launch)
      const env = this.sessionEnv(launch.env, scratchId)
      // A Claude tile tagged with its tile id and Foreman as the source: the hooks write only for these.
      const tagged: Record<string, string> = launch.file === 'claude' && ctx.mods ? { FOREMAN_TILE_ID: String(scratchId), FOREMAN_SOURCE: 'foreman' } : {}
      this.sessions.start({ key, cwd: launch.cwd, env: { ...env, ...tagged }, command: commandLine(launch, shellOf(ctx)) })
      if (launch.file === 'claude') this.attachScratch(scratchId, this.transcriptFile(launch.cwd, sessionId), sessionId)
      if (ctx.mods) this.claudeAgents?.begin(scratchId, sessionId, launch.cwd)
      this.log('scratch', `Tile ${scratch.title} started`, scratch.crewId)
      return this.scratchStatus(scratchId)
    } catch (err) {
      const failure = toForemanError(err)
      this.log('error', `Tile ${scratch.title} failed to start: ${failure.message}`, scratch.crewId)
      throw failure
    }
  }

  stopScratch(scratchId: number): void {
    this.sessions.stop(this.scratchKey(scratchId))
    if (this.chat.isRunning(scratchId)) {
      void this.chat.stop(scratchId)
    }
  }

  // A tile's output that looks like a server starting: the renderer is told to read the list again, once the output
  // has settled (1.5 s after the last such line of that tile).
  private hintServers(scratchId: number, data: string): void {
    if (!looksLikeServerStart(data)) return
    clearTimeout(this.serverHints.get(scratchId))
    const t = setTimeout(() => {
      this.serverHints.delete(scratchId)
      this.emit('servers:changed', {})
    }, 1500)
    t.unref?.()
    this.serverHints.set(scratchId, t)
  }

  // The running process of each tile that has one: the pty shell, or the Chat view's claude process.
  private tileRoots(): TileRoot[] {
    const roots: TileRoot[] = []
    for (const crew of this.store.listCrews()) {
      for (const s of this.store.listScratch(crew.id)) {
        const pid = this.sessions.pid(this.scratchKey(s.id)) ?? this.chat.get(s.id)?.pid
        if (pid) roots.push({ scratchId: s.id, pid })
      }
    }
    return roots
  }

  private scratchId(key: SessionKey): number | null {
    const m = /^scratch:(\d+)$/.exec(key)
    return m ? Number(m[1]) : null
  }

  private onScratchExit(scratchId: number, exitCode: number): void {
    if (!this.store.isOpen) return
    this.detachScratch(scratchId)
    this.cli?.revokeToken(scratchId)
    this.claudeAgents?.end(scratchId)
    this.emit('scratch:exit', { scratchId, exitCode, switching: this.switching.has(scratchId) })
    this.emit('servers:changed', {})
    const scratch = this.store.getScratch(scratchId)
    if (scratch) this.log('scratch', `Tile ${scratch.title} closed${exitCode ? ` (exit ${exitCode})` : ''}`, scratch.crewId)
  }

  // ---- Chat view (claude-chat.ts)

  private makeChatSession(scratch: ScratchTerminal, sessionId: string): ChatSession {
    const id = scratch.id
    const eventsDir = this.hookPaths?.eventsDir
    return this.chat.ensure(
      id,
      (emit) =>
        new ChatSession({
          scratchId: id,
          sessionId,
          cwd: scratch.cwd,
          transcriptFile: this.transcriptFile(scratch.cwd, sessionId),
          ...(eventsDir ? { statusFile: join(eventsDir, `status-${sessionId}.json`) } : {}),
          launch: (resume, sid) => this.chatLaunch(id, sid, resume),
          filesFor: (sid) => ({ transcriptFile: this.transcriptFile(scratch.cwd, sid), ...(eventsDir ? { statusFile: join(eventsDir, `status-${sid}.json`) } : {}) }),
          onSession: (sid) => this.store.updateScratch(id, { sessionId: sid }),
          emit,
          ...(this.chatSpawn ? { spawn: this.chatSpawn } : {}),
          now: this.now,
          onStart: (sid) => this.onChatStart(id, sid),
          onWaiting: (w) => (w ? this.claudeAgents?.setWaiting(id, w) : this.claudeAgents?.clearWaiting(id)),
          onExit: (info) => this.onChatExit(id, info),
          effort: scratch.effort || null,
          bypassAllowed: true,
          keepWarm: {
            ttlMs: () => this.cacheTtlMs(scratch),
            enabled: () => this.settings.mods.keepWarm,
            load: () => (this.store.getJson(`keepwarm.${id}`) as KeepWarmPersisted | null) ?? null,
            save: (p) => this.store.setJson(`keepwarm.${id}`, p),
          },
        }),
    )
  }

  // The tile's prompt cache lifetime as launch.ts passes it to Claude: its preset, else the Tokens default; 'auto' counts as 5 minutes.
  private cacheTtlMs(scratch: ScratchTerminal): number {
    const own = this.presetOf(scratch)?.cacheTtl ?? 'auto'
    const ttl = own === 'auto' ? this.settings.tokens.defaultCacheTtl : own
    return ttl === '1h' ? 3_600_000 : 300_000
  }

  private presetOf(scratch: ScratchTerminal): Preset | null {
    return scratch.presetId != null ? this.store.getPreset(scratch.presetId) : null
  }

  private chatLaunch(scratchId: number, sessionId: string, resume: boolean): ChatLaunchSpec {
    const scratch = this.store.getScratch(scratchId)
    if (!scratch) throw notFound(`Scratch terminal ${scratchId} not found`)
    const crew = this.store.getCrew(scratch.crewId)
    const ctx = this.launchContext(scratch.crewId, crew?.folder ?? scratch.cwd, sessionId, scratch.presetId != null)
    const launch = buildChatLaunch({ ...scratch, sessionId }, ctx, { preset: this.presetOf(scratch), resume })
    this.writeFiles(launch)
    const base = this.launch.baseEnv ?? process.env
    const cli = resolveCli('claude', base, ctx.platform)
    const tagged: Record<string, string> = ctx.mods ? { FOREMAN_TILE_ID: String(scratchId), FOREMAN_SOURCE: 'foreman' } : {}
    const env = { ...inheritedEnv(base), ...this.sessionEnv(launch.env, scratchId), ...tagged }
    if (!cli) return { file: 'claude', args: launch.args, cwd: launch.cwd, env, shell: false, blocked: 'Claude Code was not found on PATH. Install it, or check Settings > Capabilities.' }
    return { file: cli.file, args: launch.args, cwd: launch.cwd, env, shell: cli.shell }
  }

  // A Chat tile's process started: follow its transcript for spend and tell the Agents panel.
  private onChatStart(scratchId: number, sessionId: string): void {
    const scratch = this.store.getScratch(scratchId)
    if (!scratch) return
    this.attachScratch(scratchId, this.transcriptFile(scratch.cwd, sessionId), sessionId)
    // An Orchestration project feeds the graph even with mods off, as the terminal path does.
    if (this.hooksConfig(this.store.getCrew(scratch.crewId)?.factory === true)) this.claudeAgents?.begin(scratchId, sessionId, scratch.cwd)
    this.log('scratch', `Tile ${scratch.title} started (Chat view)`, scratch.crewId)
  }

  private onChatExit(scratchId: number, info: { code: number | null; expected: boolean }): void {
    // A process that ends during quit finds the database already closed.
    if (!this.store.isOpen) return
    this.detachScratch(scratchId)
    this.cli?.revokeToken(scratchId)
    this.claudeAgents?.end(scratchId)
    this.emit('scratch:exit', { scratchId, exitCode: info.code ?? 0, switching: this.switching.has(scratchId) })
    this.emit('servers:changed', {})
    const scratch = this.store.getScratch(scratchId)
    if (scratch) this.log('scratch', `Tile ${scratch.title} ${info.expected ? 'closed' : 'stopped unexpectedly'}${info.code ? ` (exit ${info.code})` : ''}`, scratch.crewId)
  }

  private startChat(scratch: ScratchTerminal, opts: { resume?: boolean }): ScratchStatus {
    const id = scratch.id
    try {
      const resume = !!opts.resume && scratch.sessionId != null
      const existing = this.chat.get(id)
      const sessionId = resume ? scratch.sessionId! : randomUUID()
      // The same conversation reopens with its items; a new one starts clean.
      if (existing && (!resume || existing.state.sessionId !== sessionId)) this.chat.forget(id)
      if (!resume) this.store.updateScratch(id, { sessionId })
      const session = this.makeChatSession(scratch, sessionId)
      session.start(resume ? undefined : false)
      return this.scratchStatus(id)
    } catch (err) {
      const failure = toForemanError(err)
      this.log('error', `Tile ${scratch.title} failed to start: ${failure.message}`, scratch.crewId)
      throw failure
    }
  }

  private waitScratchExit(scratchId: number, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer)
        this.off('scratch:exit', onExit)
        resolve(ok)
      }
      const onExit = (e: { scratchId: number }) => {
        if (e.scratchId === scratchId) done(true)
      }
      const timer = setTimeout(() => done(false), ms)
      this.on('scratch:exit', onExit)
    })
  }

  // Chat <-> Terminal on the same session, only between turns: the one process stops, the other starts with --resume.
  private async setView(scratchId: number, view: 'chat' | 'terminal'): Promise<ScratchStatus> {
    const scratch = this.requireScratch(scratchId)
    if (scratch.agent !== 'claude') throw bad('Only Claude Code tiles have a Chat view')
    if (view !== 'chat' && view !== 'terminal') throw bad('The view must be chat or terminal')
    if (scratch.view === view) return this.scratchStatus(scratchId)
    const session = this.chat.get(scratchId)
    if (session?.running && session.busy) throw conflict('Wait for Claude to finish, or Stop it, before switching views')
    const key = this.scratchKey(scratchId)
    const wasRunning = this.chat.isRunning(scratchId) || this.chat.get(scratchId)?.state.process === 'starting' || this.sessions.isRunning(key)
    this.switching.add(scratchId)
    try {
      if (view === 'terminal') {
        await this.chat.drop(scratchId)
        this.store.updateScratch(scratchId, { view })
      } else {
        if (this.sessions.isRunning(key)) {
          // The terminal is a shell that ran claude: /exit ends Claude but not the shell, so the shell is closed too.
          const exited = this.waitScratchExit(scratchId, 1500)
          this.sessions.write(key, '/exit\r')
          if (!(await exited)) {
            this.sessions.forceStop(key)
            await this.waitScratchExit(scratchId, 1000)
          }
        }
        this.store.updateScratch(scratchId, { view })
      }
      if (!wasRunning) return this.scratchStatus(scratchId)
      try {
        return this.startScratch(scratchId, { resume: true })
      } catch (err) {
        // The other side would not start: the tile keeps the view it had, so the switch can be tried again.
        this.store.updateScratch(scratchId, { view: scratch.view })
        throw err
      }
    } finally {
      this.switching.delete(scratchId)
    }
  }

  private chatHandlers(): Group<'chat'> {
    const live = (scratchId: number): ChatSession => {
      const scratch = this.requireScratch(scratchId)
      const s = this.chat.get(scratchId)
      if (!s) throw conflict(`${scratch.title} has no Chat session: start the tile first`)
      return s
    }
    return {
      'chat:snapshot': (scratchId): ChatState => {
        const scratch = this.requireScratch(scratchId)
        if (scratch.agent !== 'claude' || !scratch.sessionId) return emptyChatState(scratchId)
        return (this.chat.get(scratchId) ?? this.makeChatSession(scratch, scratch.sessionId)).snapshot()
      },
      'chat:send': (scratchId, input) => {
        if (!input || typeof input.text !== 'string') throw bad('A message needs text')
        live(scratchId).send(input)
        this.touchScratch(scratchId, input.text)
      },
      'chat:interrupt': (scratchId) => live(scratchId).interrupt(),
      'chat:stopAgent': (scratchId, toolUseId) => {
        if (typeof toolUseId !== 'string' || !toolUseId) throw bad('A sub-agent id is needed')
        if (!live(scratchId).stopAgent(toolUseId)) throw conflict('Claude Code has not reported a task id for this sub-agent, so it cannot be stopped on its own')
      },
      'chat:queueSend': (scratchId, id) => {
        const why = live(scratchId).sendHeldNow(String(id))
        if (why) throw conflict(why)
      },
      'chat:queueMove': (scratchId, id, by) => {
        if (by !== -1 && by !== 1) throw bad('A queued message moves one place up or down')
        live(scratchId).moveHeld(String(id), by)
      },
      'chat:queueRemove': (scratchId, id) => live(scratchId).removeHeld(String(id)),
      'chat:queueTake': (scratchId, id) => live(scratchId).takeHeld(String(id)),
      'chat:permission': (scratchId, requestId, decision) => {
        if (typeof requestId !== 'string' || !decision || typeof decision.kind !== 'string') throw bad('Not a valid answer')
        if (!live(scratchId).answer(requestId, decision)) throw conflict('That prompt is no longer waiting')
      },
      'chat:setMode': (scratchId, mode) => live(scratchId).setMode(String(mode)),
      'chat:setModel': (scratchId, model) => {
        validateLaunchSettings({ agent: 'claude', model })
        const s = live(scratchId)
        this.store.updateScratch(scratchId, { model })
        s.setModel(model)
        this.saveSettings(mergeSettings(this.settings, { defaultModels: { claude: model } }))
      },
      'chat:setEffort': (scratchId, level) => {
        validateLaunchSettings({ agent: 'claude', effort: level })
        const s = live(scratchId)
        this.store.updateScratch(scratchId, { effort: level })
        s.setEffort(level)
        this.saveSettings(mergeSettings(this.settings, { defaultEfforts: { claude: level } }))
      },
      'chat:requestContext': (scratchId, force) => live(scratchId).requestContext(force === true),
      'chat:history': (scratchId, beforeIndex) => live(scratchId).historyPage(Number.isInteger(beforeIndex) ? beforeIndex : 0),
      'chat:agentHistory': (scratchId, toolUseId) => {
        if (typeof toolUseId !== 'string' || !/^[\w-]{1,120}$/.test(toolUseId)) throw bad('Not a valid tool call id')
        return live(scratchId).agentHistory(toolUseId)
      },
      'chat:restart': (scratchId) => {
        const s = live(scratchId)
        s.restart()
        return s.snapshot()
      },
      'chat:rewind': async (scratchId, userItemId, revertFiles) => {
        if (typeof userItemId !== 'string' || !userItemId) throw bad('A message id is needed')
        const s = live(scratchId)
        // The process ends and starts again on a new session: not a closed tile.
        this.switching.add(scratchId)
        try {
          return await s.rewind(userItemId, revertFiles === true)
        } finally {
          this.switching.delete(scratchId)
        }
      },
      'chat:files': (scratchId, query) => listChatFiles(this.requireScratch(scratchId).cwd, typeof query === 'string' ? query.slice(0, 200) : ''),
    }
  }


  // Tile spend: one usage row per assistant message with scratch_id set.
  private attachScratch(scratchId: number, file: string, sessionId: string): void {
    this.scratchFeeds.set(scratchId, { tail: new JsonlTail(file), sessionId, prevContext: null, current: null, currentContext: 0 })
  }

  // Reads what is left of a closed or deleted tile's transcript, then stops following it.
  private detachScratch(scratchId: number): void {
    if (this.pollScratch(scratchId) > 0) this.checkBudgets()
    this.scratchFeeds.delete(scratchId)
  }

  // Returns how many usage lines were ingested.
  private pollScratch(scratchId: number): number {
    const feed = this.scratchFeeds.get(scratchId)
    if (!feed || !this.store.getScratch(scratchId)) return 0
    let n = 0
    const lines = feed.tail.read()
    for (const line of lines) {
      const u = parseLine(line)
      if (!u) continue
      if (feed.current?.messageId !== u.messageId) {
        feed.prevContext = feed.current ? feed.currentContext : null
        feed.current = { messageId: u.messageId, toolUse: false }
      }
      feed.current.toolUse ||= u.toolUse
      feed.currentContext = u.contextTokens
      this.store.upsertMessageUsage(u.messageId, {
        scratchId,
        sessionId: feed.sessionId,
        model: u.model,
        at: u.at,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheRead: u.cacheReadTokens,
        cacheW5m: u.cacheWrite5mTokens,
        cacheW1h: u.cacheWrite1hTokens,
        costUsd: u.costUsd,
        contextTokens: u.contextTokens,
        cold: isColdTurn(
          { contextTokens: u.contextTokens, cacheWriteTokens: u.cacheWrite5mTokens + u.cacheWrite1hTokens },
          feed.prevContext,
          this.settings.tokens.coldThresholdPct,
        ),
        toolUse: feed.current.toolUse,
      })
      n++
    }
    if (n > 0) this.emit('usage:changed', { crewId: this.store.getScratch(scratchId)!.crewId })
    return n
  }
}
