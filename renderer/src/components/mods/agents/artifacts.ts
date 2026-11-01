import { baseName, type ChatItem, type ToolItem } from '@shared/claude-chat'
import { fileOfTool } from './rightNow'

// The "Artifacts" list of the Agents panel: what Claude made in this session. Files it created or saved (images, pages,
// PDFs, documents), and addresses it produced or opened (a dev server, a Claude artifact). Everything comes from the chat
// stream; nothing is checked on disk here, so a path that no longer exists fails when it is opened.

export type ArtifactKind = 'image' | 'html' | 'markdown' | 'pdf' | 'document' | 'file' | 'url'

// image: Foreman's image viewer. browser: the project's browser tile. system: the default app. external: the system browser.
export type ArtifactAction = 'image' | 'browser' | 'system' | 'external'

export interface Artifact {
  key: string
  kind: ArtifactKind
  // A file path (as Claude wrote it) or an http(s) address.
  target: string
  name: string
  // created: Claude wrote the file. saved: a path in a tool's output. link: an address.
  origin: 'created' | 'saved' | 'link'
  // Every action that works for this kind; the first is what a click does.
  actions: ArtifactAction[]
}

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i
const HTML = /\.html?$/i
const MARKDOWN = /\.(?:md|markdown)$/i
const PDF = /\.pdf$/i
const DOCUMENT = /\.(?:docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv)$/i

export function artifactKind(path: string): Exclude<ArtifactKind, 'url'> {
  if (IMAGE.test(path)) return 'image'
  if (HTML.test(path)) return 'html'
  if (MARKDOWN.test(path)) return 'markdown'
  if (PDF.test(path)) return 'pdf'
  if (DOCUMENT.test(path)) return 'document'
  return 'file'
}

// The browser tile only serves .html and .md files of the project and addresses, so a PDF opens in the default app.
const ACTIONS: Record<ArtifactKind, ArtifactAction[]> = {
  image: ['image', 'system'],
  html: ['browser', 'system'],
  markdown: ['browser', 'system'],
  pdf: ['system'],
  document: ['system'],
  file: ['system'],
  url: ['browser', 'external'],
}

const ARTIFACT_TOOLS = new Set(['Write', 'NotebookEdit'])
const CREATE_ONLY_TOOLS = new Set(['Edit', 'MultiEdit'])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi
// A path with a drive or at least one separator that ends in a file type worth showing. Bare file names are not matched.
const PATH_RE = /(?<![\w.\-/\\])(?:[A-Za-z]:[\\/]|~?\/|\.{1,2}[\\/])?(?:[\w.@%+~-]+[\\/])+[\w.@%+~-]+\.(?:png|jpe?g|gif|webp|svg|pdf|html?)\b/gi

const isLocalHost = (host: string) => /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i.test(host)

// A localhost address (a dev server) or a Claude artifact link; any other address in a tool's output is not Claude's own.
function wanted(url: URL): boolean {
  if (isLocalHost(url.hostname)) return true
  return /(?:^|\.)claude\.(?:ai|site)$/i.test(url.hostname) && /\/artifacts?\b/i.test(url.pathname)
}

function urlName(url: URL): string {
  const rest = url.pathname === '/' ? '' : url.pathname
  return `${url.host}${rest}`
}

function fileArtifact(path: string, origin: 'created' | 'saved'): Artifact {
  const kind = artifactKind(path)
  const slashed = path.replace(/\\/g, '/')
  // Windows paths ignore case; others keep it.
  const key = `p:${/^[a-z]:/i.test(slashed) ? slashed.toLowerCase() : slashed}`
  return { key, kind, target: path, name: baseName(path), origin, actions: ACTIONS[kind] }
}

function urlArtifact(raw: string, onlyWanted: boolean): Artifact | null {
  let url: URL
  try {
    url = new URL(raw.replace(/[.,;:!?]+$/, ''))
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol) || (onlyWanted && !wanted(url))) return null
  // 0.0.0.0 is where a server listens, not an address a browser can open.
  if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
  const target = url.href
  return { key: `u:${target.replace(/\/$/, '')}`, kind: 'url', target, name: urlName(url), origin: 'link', actions: ACTIONS.url }
}

// The paths and addresses written in free text (a tool's output or Claude's message), in order of appearance.
function scanText(text: string, paths: boolean): Artifact[] {
  const out: Artifact[] = []
  for (const m of text.matchAll(URL_RE)) {
    const a = urlArtifact(m[0], true)
    if (a) out.push(a)
  }
  if (paths) for (const m of text.replace(URL_RE, ' ').matchAll(PATH_RE)) out.push(fileArtifact(m[0], 'saved'))
  return out
}

// Artifacts of one tool call: the file a Write or NotebookEdit made, and what its output or input names.
function toolArtifacts(t: ToolItem): Artifact[] {
  if (t.status !== 'done' || t.result?.isError) return []
  const out: Artifact[] = []
  const path = fileOfTool(t.name, t.input)
  if (path && (ARTIFACT_TOOLS.has(t.name) || CREATE_ONLY_TOOLS.has(t.name))) {
    // Source files Claude only rewrote are edits, not artifacts: a file counts when it is new, or is not code.
    const created = t.diff?.created === true
    if (created || (ARTIFACT_TOOLS.has(t.name) && artifactKind(path) !== 'file')) out.push(fileArtifact(path, 'created'))
    return out
  }
  const mcp = t.name.startsWith('mcp__')
  if (mcp) {
    const i = rec(t.input)
    const file = str(i.filename) || str(i.path)
    if (file && /screenshot|pdf/i.test(t.name) && artifactKind(file) !== 'file') out.push(fileArtifact(file, 'saved'))
    const opened = /navigate|open/i.test(t.name) ? str(i.url) : ''
    const a = opened ? urlArtifact(opened, false) : null
    if (a) out.push(a)
  }
  if (mcp || t.name === 'Bash' || t.name === 'PowerShell') out.push(...scanText(t.result?.text ?? '', true))
  return out
}

// Everything Claude made in the session, newest first, each once (a later mention moves it up). The conversation of
// sub-agents is included: their files are the session's files too.
export function artifactsOf(items: readonly ChatItem[]): Artifact[] {
  const seen = new Map<string, Artifact>()
  for (const item of items) {
    const found = item.kind === 'tool' ? toolArtifacts(item) : item.kind === 'text' ? scanText(item.md, false) : []
    for (const a of found) {
      seen.delete(a.key)
      seen.set(a.key, a)
    }
  }
  return [...seen.values()].reverse()
}

// The visible part of the list: at most `max` unless all are asked for, and how many are hidden.
export function capArtifacts(list: readonly Artifact[], showAll: boolean, max = 5): { shown: Artifact[]; more: number } {
  if (showAll || list.length <= max) return { shown: [...list], more: 0 }
  return { shown: list.slice(0, max), more: list.length - max }
}

export const ACTION_LABEL: Record<ArtifactAction, string> = {
  image: 'View image',
  browser: "Open in Foreman's browser",
  system: 'Open with default app',
  external: 'Open in your web browser',
}
