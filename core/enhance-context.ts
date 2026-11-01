import {
  ENHANCE_MAX_SESSION_LINES,
  ENHANCE_MAX_SESSION_TOKENS,
  capLines,
  conversationLines,
  emptyEnhanceContext,
  gitLines,
  type EnhanceContext,
  type RecentMessage,
} from '../shared/prompt-enhance'

import type { ChatItem } from '../shared/claude-chat'

export const ENHANCE_GIT_MS = 5000
// The conversation lines kept for the Session block.
export const ENHANCE_CONVERSATION_MESSAGES = 8

export interface EnhanceContextDeps {
  // `git status --porcelain=v1 --branch` of the project folder, or null when it is not a repo or git failed.
  git?: () => Promise<string | null>
  // The tile's recent main-thread messages, oldest first.
  messages?: () => RecentMessage[]
  // The project folder, named in the Session block.
  folder?: string | null
}

// The main thread's messages as the Session block reads them: what the person wrote, and what Claude wrote and used
// between two of those (one entry per stretch). Sub-agent work is left out.
export function recentMessages(items: readonly ChatItem[]): RecentMessage[] {
  const out: RecentMessage[] = []
  for (const item of items) {
    if (item.kind !== 'user' && item.kind !== 'text' && item.kind !== 'tool') continue
    if (item.parent !== null) continue
    if (item.kind === 'user') out.push({ role: 'user', text: item.text })
    else {
      let last = out.at(-1)
      if (last?.role !== 'assistant') out.push((last = { role: 'assistant', text: '', tools: [] }))
      if (item.kind === 'text') last.text = last.text ? `${last.text} ${item.md}` : item.md
      else last.tools = [...(last.tools ?? []), item.name]
    }
  }
  return out
}

const timed =<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve('timeout'), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })

// The session lookups (folder, git, recent conversation), each with its own timeout; a failure only drops that part. None is a model call.
export async function gatherEnhanceContext(deps: EnhanceContextDeps): Promise<EnhanceContext> {
  const out = emptyEnhanceContext()
  await Promise.all([
    (async () => {
      const lines: string[] = []
      let note = ''
      if (deps.folder) lines.push(`Folder: ${deps.folder}`)
      if (deps.git) {
        try {
          const status = await timed(deps.git(), ENHANCE_GIT_MS)
          if (status === 'timeout') note = 'git timed out'
          else if (status !== null) lines.push(...gitLines(status))
        } catch {
          note = 'git unavailable'
        }
      }
      try {
        const talk = conversationLines(deps.messages?.() ?? [], ENHANCE_CONVERSATION_MESSAGES)
        if (talk.length) lines.push('Recent conversation:', ...talk)
      } catch {
        note = note || 'conversation unavailable'
      }
      out.session = capLines(lines, ENHANCE_MAX_SESSION_LINES, ENHANCE_MAX_SESSION_TOKENS, 320)
      if (!out.session.length) out.sessionNote = note || 'no session context'
    })(),
  ])
  return out
}
