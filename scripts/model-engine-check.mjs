// The Model Engine Stop check for Orchestration mode, kept apart from op-event.mjs so tests can import it (op-event.mjs runs
// on import). Dependency-free; shipped next to op-event.mjs.
import { readFileSync, statSync } from 'node:fs'

// Which councils are still owed, as a block reason. Code changes need council-run and council-code; council-ui only when UI files changed.
export const modelEngineReason = (missing) => `Model Engine: run ${missing.join(' and ')} on the diff before saying done.`

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const COUNCIL = new Set(['council-run', 'council-ui', 'council-code'])
const UI_RE = /(^|[\\/])renderer[\\/]|\.(tsx|jsx|css|html|svelte|vue)(?![a-z0-9])/i
const DOC_PATH_RE = /\.md$|(^|[\\/])(01_Plan|00_Bible)[\\/]/i

// A real prompt is a user line that is not a tool result, not a meta line and not from a helper.
function isUserPrompt(line) {
  if (line?.type !== 'user' || line.isSidechain || line.isMeta) return false
  const content = line.message?.content
  if (typeof content === 'string') return content.trim() !== ''
  return Array.isArray(content) && content.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
}

// Transcript jsonl text -> the council members still owed for this turn (after the last real prompt); empty when none.
// A council call only clears edits made before it. Edits by a builder helper sit in the helper's own transcript, so a builder
// Agent/Task call counts as a code edit and its prompt text is the evidence of whether it touches UI files.
// Throws on nothing: unreadable or odd input returns [].
export function missingCouncils(transcriptText) {
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
    let lastCode = -1 // last non-docs edit
    let lastUi = -1 // last UI edit
    const last = { 'council-run': -1, 'council-ui': -1, 'council-code': -1 }
    let pos = 0
    for (const l of lines.slice(start)) {
      if (l?.type !== 'assistant' || !Array.isArray(l.message?.content)) continue
      for (const b of l.message.content) {
        if (b?.type !== 'tool_use') continue
        pos++
        if (EDIT_TOOLS.has(b.name)) {
          const path = typeof b.input?.file_path === 'string' ? b.input.file_path : ''
          if (DOC_PATH_RE.test(path)) continue
          lastCode = pos
          if (UI_RE.test(path)) lastUi = pos
        } else if (b.name === 'Agent' || b.name === 'Task') {
          const kind = b.input?.subagent_type
          if (kind === 'builder') {
            lastCode = pos
            if (typeof b.input?.prompt === 'string' && UI_RE.test(b.input.prompt)) lastUi = pos
          } else if (COUNCIL.has(kind)) last[kind] = pos
        }
      }
    }
    const missing = []
    if (lastCode > last['council-run']) missing.push('council-run')
    if (lastCode > last['council-code']) missing.push('council-code')
    if (lastUi > last['council-ui']) missing.push('council-ui')
    return missing
  } catch {
    return []
  }
}

// Stop payload -> the block decision to print, or null. Fails open (null) on any read or parse problem.
const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024

export function modelEngineStop(payload, readFile = (p) => readFileSync(p, 'utf8'), size = (p) => statSync(p).size) {
  try {
    if (payload?.hook_event_name !== 'Stop' || payload.stop_hook_active === true) return null
    if (typeof payload.transcript_path !== 'string' || !payload.transcript_path) return null
    if (size(payload.transcript_path) > MAX_TRANSCRIPT_BYTES) return null
    const missing = missingCouncils(readFile(payload.transcript_path))
    return missing.length ? { decision: 'block', reason: modelEngineReason(missing) } : null
  } catch {
    return null
  }
}
