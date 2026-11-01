import { describe, expect, it } from 'vitest'
import { isTileOut, parseTilePopoutQuery, sanitizeTilePopout, tilePopoutQuery, tilePopoutWindowTitle } from './tile-popout'

describe('tile pop-out', () => {
  it('accepts a whole request and tidies the title', () => {
    expect(sanitizeTilePopout({ scratchId: 4, crewId: 2, kind: 'claude', title: '  Claude:\n  Demo ' })).toEqual({ scratchId: 4, crewId: 2, kind: 'claude', title: 'Claude: Demo' })
  })

  it('refuses bad ids and kinds', () => {
    expect(sanitizeTilePopout(null)).toBeNull()
    expect(sanitizeTilePopout({ scratchId: 1.5, crewId: 2, kind: 'shell', title: 'x' })).toBeNull()
    expect(sanitizeTilePopout({ scratchId: 1, crewId: 0, kind: 'shell', title: 'x' })).toBeNull()
    expect(sanitizeTilePopout({ scratchId: 1, crewId: 2, kind: 'browser', title: 'x' })).toBeNull()
  })

  it('falls back to a plain title', () => {
    expect(sanitizeTilePopout({ scratchId: 1, crewId: 2, kind: 'shell', title: '   ' })?.title).toBe('Terminal')
  })

  it('round-trips through the URL query', () => {
    const req = { scratchId: 7, crewId: 3, kind: 'opencode' as const, title: 'OpenCode: A & B' }
    const search = '?' + new URLSearchParams(tilePopoutQuery(req)).toString()
    expect(parseTilePopoutQuery(search)).toEqual(req)
  })

  it('is not a pop-out without the tilePopout key', () => {
    expect(parseTilePopoutQuery('?browserPopout=2')).toBeNull()
    expect(parseTilePopoutQuery('?tilePopout=abc&crew=1&kind=shell')).toBeNull()
  })

  it('knows which tiles are out and names the window', () => {
    expect(isTileOut([1, 5], 5)).toBe(true)
    expect(isTileOut([1, 5], 2)).toBe(false)
    expect(isTileOut(undefined, 2)).toBe(false)
    expect(tilePopoutWindowTitle('Shell: Demo')).toBe('Shell: Demo - Foreman')
  })
})
