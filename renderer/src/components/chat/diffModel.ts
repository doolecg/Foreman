import { diffFromInput, type ChatItem, type DiffFile, type DiffHunk } from '@shared/claude-chat'
import { normalizePath } from '@shared/chat-changes'

// Pure logic behind the chat's diff panel. No React here so it can be tested.

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

// The panel opens on this window event: from the changed-files card (with the clicked file) and from the chat header (toggle).
export const DIFF_PANEL_EVENT = 'foreman:diff-panel'
export interface DiffPanelDetail {
  scratchId: number
  path?: string
  toggle?: boolean
}
// ChatView tells the header whether the panel is open (the header button shows it as pressed).
export const DIFF_STATE_EVENT = 'foreman:diff-panel-state'
export interface DiffStateDetail {
  scratchId: number
  open: boolean
}
export const openDiffPanel = (detail: DiffPanelDetail) => window.dispatchEvent(new CustomEvent<DiffPanelDetail>(DIFF_PANEL_EVENT, { detail }))

export type DiffScope = 'turn' | 'all'

// The items of the latest turn: everything from the last message the owner sent. Without one, every item.
export function latestTurnItems(items: ChatItem[]): ChatItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind === 'user' && it.parent === null) return items.slice(i)
  }
  return items
}

// The files the finished edit calls changed, in the order they were first edited. Edits to one file merge into one entry:
// counts add up and the hunks follow each other. A failed, denied or interrupted call changed nothing and is skipped.
export function collectFileDiffs(items: ChatItem[]): DiffFile[] {
  const byPath = new Map<string, DiffFile>()
  for (const it of items) {
    if (it.kind !== 'tool' || it.status !== 'done' || !EDIT_TOOLS.has(it.name)) continue
    const d = it.diff ?? diffFromInput(it.name, it.input)
    if (!d?.path) continue
    const path = normalizePath(d.path)
    const have = byPath.get(path)
    if (have) {
      have.added += d.added
      have.removed += d.removed
      have.hunks.push(...d.hunks)
    } else byPath.set(path, { path, created: d.created, added: d.added, removed: d.removed, hunks: [...d.hunks] as DiffHunk[] })
  }
  return [...byPath.values()]
}

export const filesForScope = (items: ChatItem[], scope: DiffScope): DiffFile[] => collectFileDiffs(scope === 'turn' ? latestTurnItems(items) : items)

export const viewedCount = (files: Array<Pick<DiffFile, 'path'>>, viewed: ReadonlySet<string>): number => files.filter((f) => viewed.has(f.path)).length

// The panel's progress text: "2/5 viewed".
export const viewedLabel = (done: number, total: number): string => `${done}/${total} viewed`
