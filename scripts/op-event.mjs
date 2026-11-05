// Foreman's Claude Code hook and status line writer. It has no dependencies and no model calls: Claude Code runs it
// with the app binary as Node (ELECTRON_RUN_AS_NODE=1) and pipes the event JSON to stdin.
//
//   node op-event.mjs hook <eventsDir>    appends one line {ts, tile, ...payload} to <eventsDir>/<session_id>.jsonl
//   node op-event.mjs status <eventsDir>  writes the latest payload to <eventsDir>/status-<session_id>.json and prints one line
//
// With FOREMAN_FACTORY=1 (Subagent Factory Mode), `hook` also prints a PreToolUse deny for the Agent/Task tool while 3
// helpers are running (SubagentStart minus SubagentStop in the session's events file).
//
// Only tiles Foreman launched (FOREMAN_SOURCE=foreman) write anything. It always exits 0, so a failed write never
// blocks Claude Code.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { modelEngineStop } from './model-engine-check.mjs'

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_STRING = 2000
const MAX_ITEMS = 200

// Drops prompts (they can hold the user's text) and clips long strings and lists so one event stays small.
function shrink(value, depth = 0) {
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value
  if (!value || typeof value !== 'object' || depth > 8) return value
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => shrink(item, depth + 1))
  const out = {}
  for (const [key, item] of Object.entries(value)) if (key !== 'prompt') out[key] = shrink(item, depth + 1)
  return out
}

function readStdin() {
  return new Promise((resolve) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => resolve(text))
    process.stdin.on('error', () => resolve(text))
  })
}

// One short plain line for the terminal's status bar: model, context used, session cost.
function statusText(payload) {
  const parts = []
  const model = payload.model?.display_name ?? payload.model?.id
  if (typeof model === 'string') parts.push(model)
  const used = payload.context_window?.used_percentage
  if (typeof used === 'number') parts.push(`ctx ${Math.round(used)}%`)
  const cost = payload.cost?.total_cost_usd
  if (typeof cost === 'number') parts.push(`$${cost.toFixed(2)}`)
  return parts.join(' | ')
}

const FACTORY_CAP = 3

// Subagent Factory Mode: the helpers running in this session, from its events file (SubagentStart minus SubagentStop).
// A helper that started longer ago than this and never reported a stop (Esc, a crash) no longer counts.
const HELPER_MAX_AGE_MS = 15 * 60_000

function runningHelpers(file) {
  let n = 0
  const now = Date.now()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const e = JSON.parse(line)
      if (e.hook_event_name === 'SubagentStart') {
        if (typeof e.ts !== 'number' || now - e.ts < HELPER_MAX_AGE_MS) n++
      } else if (e.hook_event_name === 'SubagentStop') n = Math.max(0, n - 1)
    } catch {
      /* a torn line counts for nothing */
    }
  }
  return Math.max(0, n)
}

// With FOREMAN_FACTORY=1, a PreToolUse for the Agent/Task tool is denied while FACTORY_CAP helpers are running. Any read or
// parse problem allows the call (prints nothing).
function factoryCap(file, payload) {
  if (process.env.FOREMAN_FACTORY !== '1' || payload.hook_event_name !== 'PreToolUse') return
  if (payload.tool_name !== 'Agent' && payload.tool_name !== 'Task') return
  try {
    if (runningHelpers(file) < FACTORY_CAP) return
  } catch {
    return
  }
  const reason = `Orchestrator Mode: ${FACTORY_CAP} helpers are already running. Wait for one to finish.`
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`)
}

async function main() {
  const [mode, eventsDir] = process.argv.slice(2)
  if (process.env.FOREMAN_SOURCE !== 'foreman' || !eventsDir || (mode !== 'hook' && mode !== 'status')) return
  let payload
  try {
    payload = JSON.parse(await readStdin())
  } catch {
    return
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const sessionId = payload.session_id
  if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) return
  mkdirSync(eventsDir, { recursive: true })
  const tile = process.env.FOREMAN_TILE_ID ?? null
  if (mode === 'hook') {
    const file = join(eventsDir, `${sessionId}.jsonl`)
    appendFileSync(file, `${JSON.stringify({ ts: Date.now(), tile, ...shrink(payload) })}\n`)
    factoryCap(file, payload)
    if (process.env.FOREMAN_FACTORY === '1') {
      const block = modelEngineStop(payload)
      if (block) process.stdout.write(`${JSON.stringify(block)}\n`)
    }
    return
  }
  const file = join(eventsDir, `status-${sessionId}.json`)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ ts: Date.now(), tile, ...shrink(payload) }))
  renameSync(tmp, file)
  const text = statusText(payload)
  if (text) process.stdout.write(`${text}\n`)
}

main().catch(() => undefined).finally(() => {
  process.exitCode = 0
})
