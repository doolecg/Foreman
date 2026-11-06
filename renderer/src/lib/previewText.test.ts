import { describe, expect, it } from 'vitest'
import { previewText } from './previewText'

describe('previewText', () => {
  it('returns nothing for empty text', () => {
    expect(previewText('', 3)).toEqual({ lines: [], hidden: 0, clipped: false })
  })
  it('keeps one short line', () => {
    expect(previewText('ls -la', 3)).toEqual({ lines: ['ls -la'], hidden: 0, clipped: false })
  })
  it('splits CRLF and lone CR', () => {
    expect(previewText('a\r\nb\rc\r\nd', 3)).toEqual({ lines: ['a', 'b', 'c'], hidden: 1, clipped: false })
  })
  it('counts hidden lines of a 100-line text', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const p = previewText(text, 3)
    expect(p.lines).toEqual(['line 0', 'line 1', 'line 2'])
    expect(p.hidden).toBe(97)
  })
  it('truncates a very long line with an ellipsis and flags it', () => {
    const p = previewText('x'.repeat(500), 3, 120)
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0]).toHaveLength(120)
    expect(p.lines[0]!.endsWith('…')).toBe(true)
    expect(p.hidden).toBe(0)
    expect(p.clipped).toBe(true)
  })
  it('does not split an emoji at the cut point', () => {
    const p = previewText('x'.repeat(118) + '😀' + 'y'.repeat(20), 3, 120)
    expect(p.lines[0]).toBe('x'.repeat(118) + '…')
  })
  it('ignores one trailing newline but keeps inner blank lines', () => {
    expect(previewText('a\n', 3)).toEqual({ lines: ['a'], hidden: 0, clipped: false })
    expect(previewText('a\n\nb\n', 3)).toEqual({ lines: ['a', '', 'b'], hidden: 0, clipped: false })
  })
})
