import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MOD_DEFAULT_ENABLED, type ModId } from '../shared/mods'
import { hooksConfig, modsCommand, parseEventLine, parseStatusFile } from './claude-events'

const SCRIPT = resolve(process.cwd(), 'scripts', 'op-event.mjs')
const SID = '11111111-2222-4333-8444-555555555555'
const paths = { node: 'C:\\Program Files\\Foreman\\Foreman.exe', script: 'C:\\app\\scripts\\op-event.mjs', eventsDir: 'C:\\Users\\Dayle Frost\\AppData\\Roaming\\Foreman\\events' }

let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

const mods = (on: Partial<Record<ModId, boolean>> = {}) => ({ ...MOD_DEFAULT_ENABLED, ...on })

describe('Mods hooks config', () => {
  it('is null when mods are off', () => {
    expect(hooksConfig(paths, { enabled: false, mods: mods({ subagents: true }), keepWarm: true, commandMenu: true })).toBeNull()
  })

  it('registers the session and sub-agent events, and the Agent matcher, while the subagents mod is on', () => {
    const cfg = hooksConfig(paths, { enabled: true, mods: mods({ subagents: true }), keepWarm: true, commandMenu: true })!
    expect(Object.keys(cfg.hooks).sort()).toEqual(['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit'])
    expect(cfg.hooks.PreToolUse).toEqual([{ matcher: 'Agent', hooks: [{ type: 'command', command: expect.any(String) }] }])
    // Without Orchestration the PostToolUse matcher stays Agent-only: no extra process per search or memory call.
    expect(cfg.hooks.PostToolUse).toEqual([{ matcher: 'Agent', hooks: [{ type: 'command', command: expect.any(String) }] }])
    expect(cfg.hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: expect.any(String) }] }])
    expect(cfg.statusLine).toEqual({ type: 'command', command: expect.stringContaining(' status ') })
  })

  it('registers no hooks for the native mods alone, but keeps the status line', () => {
    const cfg = hooksConfig(paths, { enabled: true, mods: mods({ subagents: false, folderTracker: true }), keepWarm: true, commandMenu: true })!
    expect(cfg.hooks).toEqual({})
    expect(cfg.statusLine!.command).toContain(' status ')
  })

  it('quotes the command with forward slashes and the events folder, and refuses unsafe paths', () => {
    const cmd = modsCommand(paths, 'hook')!
    expect(cmd).toBe(
      'ELECTRON_RUN_AS_NODE=1 "C:/Program Files/Foreman/Foreman.exe" "C:/app/scripts/op-event.mjs" hook "C:/Users/Dayle Frost/AppData/Roaming/Foreman/events"',
    )
    expect(modsCommand({ ...paths, eventsDir: 'C:/a$b' }, 'hook')).toBeNull()
    expect(hooksConfig({ ...paths, script: 'C:/x"y.mjs' }, { enabled: true, mods: mods({ subagents: true }), keepWarm: true, commandMenu: true })).toBeNull()
  })
})

describe('event and status parsing', () => {
  it('reads a hook line with its tile tag and session id', () => {
    const e = parseEventLine(JSON.stringify({ ts: 5, tile: '7', hook_event_name: 'SubagentStop', session_id: SID, agent_id: 'x' }))
    expect(e).toMatchObject({ ts: 5, tile: 7, sessionId: SID, name: 'SubagentStop' })
    expect(e?.payload.agent_id).toBe('x')
  })

  it('rejects lines that are not events Foreman can use', () => {
    expect(parseEventLine('not json')).toBeNull()
    expect(parseEventLine(JSON.stringify({ hook_event_name: 'Stop', session_id: '../evil' }))).toBeNull()
    expect(parseEventLine(JSON.stringify({ session_id: SID }))).toBeNull()
    expect(parseEventLine(JSON.stringify({ hook_event_name: 'Stop', session_id: SID, tile: null }))?.tile).toBeNull()
  })

  it('reduces a status payload to the fields it has', () => {
    const s = parseStatusFile(
      JSON.stringify({
        ts: 9,
        model: { id: 'claude-opus-5-5', display_name: 'Opus' },
        context_window: { context_window_size: 200000, used_percentage: 12.5, current_usage: { input_tokens: 3, cache_read_input_tokens: 40 } },
        cost: { total_cost_usd: 0.42, total_duration_ms: 1000 },
      }),
    )
    expect(s).toEqual({
      model: 'Opus',
      contextWindowSize: 200000,
      usedPercentage: 12.5,
      currentUsage: { inputTokens: 3, cacheReadTokens: 40 },
      costUsd: 0.42,
      durationMs: 1000,
      updatedAt: 9,
    })
    expect(parseStatusFile('{"model":{}}')).toEqual({ updatedAt: 0 })
    expect(parseStatusFile('oops')).toBeNull()
  })
})

describe('hooksConfig Factory Mode', () => {
  const off = { enabled: false, mods: mods({ subagents: false }), keepWarm: true, commandMenu: true }

  it('installs the sub-agent events and the Agent|Task PreToolUse hook with no status line when mods are off', () => {
    const cfg = hooksConfig(paths, off, true)!
    expect(Object.keys(cfg.hooks).sort()).toEqual(['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit'])
    expect(cfg.hooks.PostToolUse).toEqual([{ matcher: 'Agent|Task|Grep|mcp__codegraph__.*|mcp__hindsight__.*', hooks: [{ type: 'command', command: expect.any(String) }] }])
    expect(cfg.hooks.PostToolUseFailure).toEqual([{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: expect.any(String) }] }])
    expect(cfg.hooks.PreToolUse).toEqual([{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: expect.stringContaining(' hook ') }] }])
    expect(cfg.statusLine).toBeUndefined()
  })

  it('is independent of the subagents panel mod, and widens the panel PreToolUse matcher when both are on', () => {
    const noPanel = hooksConfig(paths, { ...off, enabled: true }, true)!
    expect(Object.keys(noPanel.hooks).sort()).toEqual(['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit'])
    expect(noPanel.statusLine).toBeDefined()
    const both = hooksConfig(paths, { ...off, enabled: true, mods: mods({ subagents: true }) }, true)!
    expect(both.hooks.PreToolUse).toEqual([{ matcher: 'Agent|Task', hooks: expect.any(Array) }])
    expect(both.hooks.PostToolUse).toEqual([{ matcher: 'Agent|Task|Grep|mcp__codegraph__.*|mcp__hindsight__.*', hooks: expect.any(Array) }])
  })

  it('stays null with mods off and Factory off', () => {
    expect(hooksConfig(paths, off, false)).toBeNull()
  })
})

describe('op-event.mjs Factory cap', () => {
  const started = (n: number, stopped = 0) => [
    ...Array.from({ length: n }, () => ({ hook_event_name: 'SubagentStart', session_id: SID })),
    ...Array.from({ length: stopped }, () => ({ hook_event_name: 'SubagentStop', session_id: SID })),
  ]

  function pre(tool: string, events: object[], env: Record<string, string> = { FOREMAN_FACTORY: '1' }, raw = '') {
    const dir = mkdtempSync(join(tmpdir(), 'op-event-'))
    dirs.push(dir)
    const eventsDir = join(dir, 'events')
    mkdirSync(eventsDir, { recursive: true })
    writeFileSync(join(eventsDir, `${SID}.jsonl`), events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '') + raw)
    const res = spawnSync(process.execPath, [SCRIPT, 'hook', eventsDir], {
      input: JSON.stringify({ session_id: SID, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {} }),
      env: { PATH: process.env.PATH ?? '', FOREMAN_SOURCE: 'foreman', FOREMAN_TILE_ID: '7', ...env },
      encoding: 'utf8',
    })
    return res
  }

  it('denies an Agent or Task call while 3 helpers run, with the Claude Code PreToolUse deny decision', () => {
    for (const tool of ['Agent', 'Task']) {
      const res = pre(tool, started(3))
      expect(res.status).toBe(0)
      expect(JSON.parse(res.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Orchestrator Mode: 3 helpers are already running. Wait for one to finish.',
        },
      })
    }
  })

  it('replayed through the hook itself: silent for helpers 1 to 3, denies the 4th Agent call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'op-event-'))
    dirs.push(dir)
    const eventsDir = join(dir, 'events')
    const send = (hook_event_name: string, extra: Record<string, unknown> = {}) =>
      spawnSync(process.execPath, [SCRIPT, 'hook', eventsDir], {
        input: JSON.stringify({ session_id: SID, hook_event_name, ...extra }),
        env: { PATH: process.env.PATH ?? '', FOREMAN_SOURCE: 'foreman', FOREMAN_TILE_ID: '7', FOREMAN_FACTORY: '1' },
        encoding: 'utf8',
      })
    for (const quiet of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) expect([quiet, send(quiet).stdout]).toEqual([quiet, ''])
    for (let n = 1; n <= 3; n++) {
      const call = send('PreToolUse', { tool_name: 'Agent', tool_input: {} })
      expect([n, call.status, call.stdout]).toEqual([n, 0, ''])
      expect(send('SubagentStart', { agent_id: `h${n}` }).stdout).toBe('')
    }
    const fourth = send('PreToolUse', { tool_name: 'Agent', tool_input: {} })
    expect(fourth.status).toBe(0)
    expect(JSON.parse(fourth.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' })
    send('SubagentStop', { agent_id: 'h1' })
    expect(send('PreToolUse', { tool_name: 'Agent', tool_input: {} }).stdout).toBe('')
  })

  it('allows the call under the cap, once helpers have stopped, and for other tools', () => {
    expect(pre('Agent', started(2)).stdout).toBe('')
    expect(pre('Agent', started(4, 2)).stdout).toBe('')
    expect(pre('Agent', started(3, 3)).stdout).toBe('')
    expect(pre('Bash', started(3)).stdout).toBe('')
  })

  it('does not count helpers that started long ago and never reported a stop', () => {
    const old = Date.now() - 60 * 60_000
    const stale = Array.from({ length: 3 }, () => ({ hook_event_name: 'SubagentStart', session_id: SID, ts: old }))
    expect(pre('Agent', stale).stdout).toBe('')
    expect(pre('Agent', [...stale, ...started(2)]).stdout).toBe('')
  })

  it('does nothing when Factory Mode is off', () => {
    expect(pre('Agent', started(5), {}).stdout).toBe('')
  })

  it('ignores a torn line, and allows when there is nothing to read', () => {
    expect(pre('Agent', started(2), { FOREMAN_FACTORY: '1' }, '{"hook_event_na').stdout).toBe('')
    expect(pre('Agent', []).stdout).toBe('')
  })
})

describe('op-event.mjs', () => {
  function run(mode: string, input: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'op-event-'))
    dirs.push(dir)
    const events = join(dir, 'events')
    const res = spawnSync(process.execPath, [SCRIPT, mode, events], {
      input,
      env: { PATH: process.env.PATH ?? '', FOREMAN_SOURCE: 'foreman', FOREMAN_TILE_ID: '7', ...env },
      encoding: 'utf8',
    })
    return { res, events }
  }

  it('appends a tagged hook line to the session file and drops prompts', () => {
    const payload = { session_id: SID, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'Map', prompt: 'private' } }
    const { res, events } = run('hook', JSON.stringify(payload))
    expect(res.status).toBe(0)
    const lines = readFileSync(join(events, `${SID}.jsonl`), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]!)
    expect(line).toMatchObject({ tile: '7', hook_event_name: 'PreToolUse', tool_input: { description: 'Map' } })
    expect(typeof line.ts).toBe('number')
    expect(line.tool_input).not.toHaveProperty('prompt')
  })

  it('writes the latest status and prints one line', () => {
    const payload = { session_id: SID, model: { display_name: 'Haiku' }, context_window: { used_percentage: 30 }, cost: { total_cost_usd: 0.1 } }
    const { res, events } = run('status', JSON.stringify(payload))
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe('Haiku | ctx 30% | $0.10')
    expect(JSON.parse(readFileSync(join(events, `status-${SID}.json`), 'utf8'))).toMatchObject({ tile: '7', model: { display_name: 'Haiku' } })
  })

  it('writes nothing outside Foreman tiles and exits 0 on bad input', () => {
    const { res, events } = run('hook', JSON.stringify({ session_id: SID, hook_event_name: 'Stop' }), { FOREMAN_SOURCE: '' })
    expect(res.status).toBe(0)
    expect(existsSync(events)).toBe(false)
    const bad = run('hook', 'not json')
    expect(bad.res.status).toBe(0)
    expect(existsSync(bad.events)).toBe(false)
  })
})
