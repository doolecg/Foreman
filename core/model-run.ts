import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killTree, spawnHidden } from './proc'
import { buildClaudeRunLaunch } from './launch'

export interface MasterEvent {
  kind: string
  text?: string
}

// What a call used, when the CLI reports it: every input (cached too) and output token, and the cost.
export interface RunUsage {
  tokens: number
  usd: number
}

export interface MasterRun {
  stop(): Promise<void>
  done: Promise<{ ok: boolean; text: string; usage?: RunUsage }>
}

// A one-shot model call's deadline: past `ms` the run is stopped (no child process is left behind) and the call fails.
export const MODEL_TIMEOUT_MS = 120_000

export async function resultWithin(run: MasterRun, ms: number, what: string): Promise<{ ok: boolean; text: string; usage?: RunUsage }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms)
  })
  try {
    return await Promise.race([run.done, late])
  } catch (err) {
    void run.stop().catch(() => undefined)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// What one one-shot model call runs.
export interface MasterStart {
  cwd: string
  prompt: string
  model?: string
  effort?: string
  // The project's permission mode; only the OpenCode adapter reads it (to decide on --auto).
  permissionMode?: string
  onEvent: (e: MasterEvent) => void
}

// One CLI a one-shot model call can run on. `start` resolves once the CLI is running; `done` settles when the job ends.
export interface MasterAdapter {
  start(o: MasterStart): Promise<MasterRun>
}

export interface ClaudeChild {
  stdin: { write(data: string): unknown; end(): unknown }
  stdout: { on(event: 'data', fn: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', fn: (chunk: Buffer | string) => void): unknown }
  on(event: 'exit', fn: (code: number | null) => void): unknown
  on(event: 'error', fn: (err: Error) => void): unknown
  kill(): unknown
}

export type ClaudeSpawn = (file: string, args: string[], opts: { cwd: string }) => ClaudeChild

export { e2eClaudeModel } from './launch'

// Unit tests must never reach the owner's real `claude` or `opencode` (they cost money and run their hooks): they inject a spawn.
// e2e runs use the real CLIs (claude always on Haiku, see e2eClaudeModel; opencode on the model the script sets).
export function assertFakeClaude(env: NodeJS.ProcessEnv = process.env, cli: 'claude' | 'opencode' = 'claude'): void {
  if (env.VITEST) throw new Error(`A test tried to start the real ${cli}: inject a spawn or a model instead`)
}

// A settings file whose only content turns hooks off; `claude --settings` layers it over the user's own settings.
export function noHooksSettingsFile(dir: string = tmpdir()): string {
  const file = join(dir, 'foreman-claude-no-hooks.json')
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, '{"disableAllHooks":true}\n')
  return file
}

const realSpawn: ClaudeSpawn = (file, args, opts) => {
  assertFakeClaude()
  const child = spawnHidden(file, args, { cwd: opts.cwd, shell: process.platform === 'win32', stdio: 'pipe', source: 'claude-run' })
  const kill = () => killTree(child)
  return Object.assign(child, { kill }) as unknown as ClaudeChild
}

export interface ClaudeAdapterOptions {
  spawn?: ClaudeSpawn
  supported?: ReadonlySet<string>
  permissionMode?: string
  // Whether the user's own Claude hooks and plugins run in this call (read per start, so a setting applies live).
  // Default false: short model calls and runs never fire hooks, which open console windows from a no-console process.
  userHooks?: () => boolean
}

interface StreamLine {
  type?: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  message?: { content?: Array<{ type?: string; text?: string; name?: string }> }
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  total_cost_usd?: number
}

// The result line's usage as one token total and its cost; undefined when it has none.
export function resultUsage(msg: Pick<StreamLine, 'usage' | 'total_cost_usd'>): RunUsage | undefined {
  const u = msg.usage
  if (!u) return undefined
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  return { tokens: n(u.input_tokens) + n(u.output_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), usd: n(msg.total_cost_usd) }
}

// Claude Code: `claude -p` with stream-json output, built on the same checks as the interactive launch.
export class ClaudeAdapter implements MasterAdapter {
  constructor(private readonly opts: ClaudeAdapterOptions = {}) {}

  async start(o: MasterStart): Promise<MasterRun> {
    const launch = buildClaudeRunLaunch(
      { cwd: o.cwd, model: o.model, effort: o.effort, permissionMode: this.opts.permissionMode ?? 'acceptEdits', ...(this.opts.userHooks?.() ? {} : { settingsFile: noHooksSettingsFile() }) },
      { supported: this.opts.supported },
    )
    const child = (this.opts.spawn ?? realSpawn)(launch.file, launch.args, { cwd: launch.cwd })

    let result: { ok: boolean; text: string; usage?: RunUsage } | null = null
    let lastText = ''
    let stderr = ''
    let buffer = ''
    let sessionSent = false
    const line = (raw: string) => {
      let msg: StreamLine
      try {
        msg = JSON.parse(raw) as StreamLine
      } catch {
        return
      }
      if (msg.session_id && !sessionSent) {
        sessionSent = true
        o.onEvent({ kind: 'session', text: msg.session_id })
      }
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            lastText = block.text
            o.onEvent({ kind: 'text', text: block.text })
          } else if (block.type === 'tool_use') o.onEvent({ kind: 'tool', text: block.name })
        }
      } else if (msg.type === 'result') {
        const usage = resultUsage(msg)
        result = { ok: !msg.is_error && (msg.subtype === undefined || msg.subtype === 'success'), text: String(msg.result ?? lastText), ...(usage ? { usage } : {}) }
      }
    }
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, nl).trim())
        buffer = buffer.slice(nl + 1)
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    let stopped = false
    const done = new Promise<{ ok: boolean; text: string; usage?: RunUsage }>((resolve) => {
      child.on('error', (err) => resolve({ ok: false, text: `Could not start claude: ${err.message}` }))
      child.on('exit', (code) => {
        if (buffer.trim()) line(buffer.trim())
        if (result) resolve(result)
        else if (stopped) resolve({ ok: false, text: 'Stopped' })
        else resolve({ ok: false, text: stderr.trim() || lastText || `claude exited with code ${code ?? 'unknown'}` })
      })
    })

    child.stdin.write(o.prompt)
    child.stdin.end()

    return {
      done,
      stop: async () => {
        stopped = true
        child.kill()
        await done
      },
    }
  }
}
