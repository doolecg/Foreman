import { Notification } from 'electron'
import type { Foreman } from '../core/foreman'
import { emptyChatState, pendingPrompts, reduceChat, tileState, type ChatItem, type ChatState } from '../shared/claude-chat'
import type { ClaudeTileState } from '../shared/mods'
import { notifyCopy, shouldNotify, type NotifyKind } from '../shared/notify'

// Chat tiles keep only their newest items here: the turn phase and the last reply are all the notifier needs.
const CHAT_KEEP = 40
// The same tile's kind of event within this window is one turn (a chat tile can report through both feeds).
const DEDUPE_MS = 3000

export interface TurnWatch {
  busy(scratchId: number): boolean
  setVisible(scratchId: number | null): void
}

export interface TurnWatchDeps {
  isWindowFocused(): boolean
  open(scratchId: number, crewId: number): void
}

// Follows the Claude tiles' turns from the events the core emits, and raises a Windows notification when a turn finishes
// or Claude waits for the owner (only when the window is unfocused or the tile is not on screen).
export function watchClaudeTurns(foreman: Foreman, deps: TurnWatchDeps): TurnWatch {
  const chats = new Map<number, ChatState>()
  const phases = new Map<number, string>()
  const recent = new Map<string, number>()
  const live = new Set<Notification>()
  let visible: number | null = null

  const describe = async (scratchId: number): Promise<{ name: string; crewId: number } | null> => {
    for (const crew of await foreman.handlers['crews:list']()) {
      const found = (await foreman.handlers['scratch:list'](crew.id)).find((s) => s.id === scratchId)
      if (found) return { name: found.title, crewId: crew.id }
    }
    return null
  }

  const fire = (scratchId: number, kind: NotifyKind, detail: string): void => {
    if (process.env.FOREMAN_E2E === '1' || !Notification.isSupported()) return
    const key = `${scratchId}:${kind}`
    const now = Date.now()
    if (now - (recent.get(key) ?? 0) < DEDUPE_MS) return
    recent.set(key, now)
    void describe(scratchId).then((found) => {
      if (!found) return
      const enabled = foreman.currentSettings.notify
      if (!shouldNotify({ kind, enabled, windowFocused: deps.isWindowFocused(), tileVisible: visible === scratchId })) return
      const copy = notifyCopy({ kind, name: found.name, detail })
      const note = new Notification({ title: copy.title, body: copy.body })
      live.add(note)
      const done = () => live.delete(note)
      note.on('click', () => {
        done()
        deps.open(scratchId, found.crewId)
      })
      note.on('close', done)
      note.show()
    })
  }

  const lastReply = (items: ChatItem[]): string => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it?.kind === 'text' && it.parent === null) return it.md
    }
    return ''
  }

  const waitingText = (items: ChatItem[]): string => {
    const p = pendingPrompts(items)[0]
    if (!p) return ''
    if (p.kind === 'permission') return `Claude needs your permission to use ${p.displayName || p.toolName}`
    return 'Claude has a question for you'
  }

  foreman.on('chat:ops', ({ scratchId, ops }) => {
    const prev = chats.get(scratchId) ?? emptyChatState(scratchId)
    const before = tileState(prev)
    let next = reduceChat(prev, ops)
    if (next.items.length > CHAT_KEEP) next = { ...next, items: next.items.slice(-CHAT_KEEP) }
    chats.set(scratchId, next)
    const after = tileState(next)
    if (before === 'Working' && after === 'Idle') fire(scratchId, 'finished', lastReply(next.items))
    else if (after === 'Waiting for you' && before !== after) fire(scratchId, 'needs', waitingText(next.items))
  })

  foreman.on('claudeTile:state', (s: ClaudeTileState) => {
    const prev = phases.get(s.tileId)
    const phase = s.session.phase
    phases.set(s.tileId, phase)
    if (prev === 'working' && phase === 'idle') fire(s.tileId, 'finished', '')
    else if (phase === 'waiting' && prev !== 'waiting') fire(s.tileId, 'needs', s.session.waiting?.message ?? '')
  })

  return {
    busy: (scratchId) => {
      const chat = chats.get(scratchId)
      return (chat !== undefined && tileState(chat) === 'Working') || phases.get(scratchId) === 'working'
    },
    setVisible: (scratchId) => {
      visible = scratchId
    },
  }
}
