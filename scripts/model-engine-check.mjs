// The Model Engine Stop check for Orchestration mode, kept apart from op-event.mjs so tests can import it (op-event.mjs runs
// on import). Dependency-free; shipped next to op-event.mjs.
import { readFileSync, statSync } from 'node:fs'

export const MODEL_ENGINE_REASON = 'Model Engine: run council-run, council-ui and council-code on the diff before saying done.'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const COUNCIL = new Set(['council-run', 'council-ui', 'council-code'])

// A real prompt is a user line that is not a tool result, not a meta line and not from a helper.
function isUserPrompt(line) {
  if (line?.type !== 'user' || line.isSidechain || line.isMeta) return false
  const content = line.message?.content
  if (typeof content === 'string') return content.trim() !== ''
  return Array.isArray(content) && content.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
}

// Transcript jsonl text -> true when the last file change this turn (after the last real prompt) comes after the last council helper call.
// Edits by a builder helper sit in the helper's own transcript, so a builder Agent/Task call counts as an edit.
// Throws on nothing: unreadable or odd input returns false.
export function needsCouncil(transcriptText) {
  try {
    const lines = []
    for (const raw of String(transcriptText).split('\n')) {
      if (!raw.trim()) continue
      try {
        lines.push(JSON.parse(raw))
      } catch {
        /* a torn line counts for nothing */
      }
    }
    let start = 0
    lines.forEach((l, i) => {
      if (isUserPrompt(l)) start = i + 1
    })
    // Order matters: a council run only clears edits made before it.
    let lastEdit = -1
    let lastCouncil = -1
    let pos = 0
    for (const l of lines.slice(start)) {
      if (l?.type !== 'assistant' || !Array.isArray(l.message?.content)) continue
      for (const b of l.message.content) {
        if (b?.type !== 'tool_use') continue
        pos++
        if (EDIT_TOOLS.has(b.name)) lastEdit = pos
        else if (b.name === 'Agent' || b.name === 'Task') {
          const kind = b.input?.subagent_type
          if (kind === 'builder') lastEdit = pos
          else if (COUNCIL.has(kind)) lastCouncil = pos
        }
      }
    }
    return lastEdit > lastCouncil
  } catch {
    return false
  }
}

// Stop payload -> the block decision to print, or null. Fails open (null) on any read or parse problem.
const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024

export function modelEngineStop(payload, readFile = (p) => readFileSync(p, 'utf8'), size = (p) => statSync(p).size) {
  try {
    if (payload?.hook_event_name !== 'Stop' || payload.stop_hook_active === true) return null
    if (typeof payload.transcript_path !== 'string' || !payload.transcript_path) return null
    if (size(payload.transcript_path) > MAX_TRANSCRIPT_BYTES) return null
    return needsCouncil(readFile(payload.transcript_path)) ? { decision: 'block', reason: MODEL_ENGINE_REASON } : null
  } catch {
    return null
  }
}
