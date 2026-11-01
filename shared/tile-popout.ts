// A terminal tile in its own window. The window loads the app with these values in the URL query, so the page knows
// which session to attach to without asking the main process first.
export type TilePopoutKind = 'shell' | 'claude' | 'opencode'

export interface TilePopoutRequest {
  scratchId: number
  crewId: number
  kind: TilePopoutKind
  title: string
}

const KINDS: readonly string[] = ['shell', 'claude', 'opencode']

// The request as the main process accepts it: whole ids, a known kind and a short single-line title; null otherwise.
export function sanitizeTilePopout(raw: unknown): TilePopoutRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const { scratchId, crewId, kind, title } = r
  if (typeof scratchId !== 'number' || !Number.isInteger(scratchId) || scratchId <= 0) return null
  if (typeof crewId !== 'number' || !Number.isInteger(crewId) || crewId <= 0) return null
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null
  const clean = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  return { scratchId, crewId, kind: kind as TilePopoutKind, title: clean || 'Terminal' }
}

export function tilePopoutQuery(req: TilePopoutRequest): Record<string, string> {
  return { tilePopout: String(req.scratchId), crew: String(req.crewId), kind: req.kind, title: req.title }
}

// Reads the query of a pop-out window's URL (location.search); null when the page is not a tile pop-out.
export function parseTilePopoutQuery(search: string): TilePopoutRequest | null {
  const q = new URLSearchParams(search)
  if (!q.has('tilePopout')) return null
  return sanitizeTilePopout({ scratchId: Number(q.get('tilePopout')), crewId: Number(q.get('crew')), kind: q.get('kind'), title: q.get('title') })
}

export const tilePopoutWindowTitle = (title: string): string => `${title} - Foreman`

export const isTileOut = (out: readonly number[] | undefined, scratchId: number): boolean => out?.includes(scratchId) === true
