import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/claude-chat'
import { artifactKind, artifactsOf, capArtifacts } from './artifacts'

const tool = (name: string, input: Record<string, unknown>, over: Record<string, unknown> = {}): ChatItem =>
  ({ kind: 'tool', id: `t${Math.random()}`, parent: null, name, input, status: 'done', diff: null, partial: '', summary: '', result: null, background: false, startedAt: 0, endedAt: null, ...over }) as ChatItem
const result = (text: string, isError = false) => ({ text, summary: text, isError, truncated: false, images: [] })
const bash = (text: string) => tool('Bash', { command: 'x' }, { result: result(text) })
const created = (path: string) => ({ path, created: true, added: 1, removed: 0, hunks: [] })
const text = (md: string): ChatItem => ({ kind: 'text', id: `x${Math.random()}`, parent: null, md, streaming: false }) as ChatItem

describe('artifact kind and actions', () => {
  it('sorts paths by type', () => {
    expect(['a.PNG', 'b.svg', 'c.html', 'd.md', 'e.pdf', 'f.docx', 'g.ts'].map(artifactKind)).toEqual(['image', 'image', 'html', 'markdown', 'pdf', 'document', 'file'])
  })
  it('picks the primary action by type', () => {
    const [other, pdf, page, img, url] = artifactsOf([
      tool('Write', { file_path: '/p/o.ts' }, { diff: created('/p/o.ts') }),
      tool('Write', { file_path: '/p/d.pdf' }),
      tool('Write', { file_path: '/p/p.html' }),
      tool('Write', { file_path: '/p/i.png' }),
      bash('listening on http://localhost:5173/'),
    ]).reverse()
    expect(url!.actions).toEqual(['browser', 'external'])
    expect(img!.actions).toEqual(['image', 'system'])
    expect(page!.actions).toEqual(['browser', 'system'])
    expect(pdf!.actions).toEqual(['system'])
    expect(other!.actions).toEqual(['system'])
  })
})

describe('artifactsOf', () => {
  it('lists new files and non-code files from Write, not rewritten source', () => {
    const list = artifactsOf([
      tool('Write', { file_path: '/p/new.ts' }, { diff: created('/p/new.ts') }),
      tool('Write', { file_path: '/p/old.ts' }, { diff: { ...created('/p/old.ts'), created: false } }),
      tool('Write', { file_path: '/p/page.html' }),
      tool('Edit', { file_path: '/p/edited.md' }),
      tool('Edit', { file_path: '/p/made.md' }, { diff: created('/p/made.md') }),
      tool('NotebookEdit', { notebook_path: '/p/n.ipynb' }, { diff: created('/p/n.ipynb') }),
    ])
    expect(list.map((a) => a.name)).toEqual(['n.ipynb', 'made.md', 'page.html', 'new.ts'])
    expect(list.every((a) => a.origin === 'created')).toBe(true)
  })
  it('ignores failed and running tools', () => {
    expect(artifactsOf([tool('Write', { file_path: '/p/a.html' }, { status: 'failed' }), tool('Write', { file_path: '/p/b.html' }, { status: 'running' }), bash('')])).toEqual([])
    expect(artifactsOf([tool('Bash', {}, { result: result('saved /p/shot.png', true) })])).toEqual([])
  })
  it('finds saved image and page paths in command output', () => {
    const list = artifactsOf([bash('Saved C:\\proj\\docs\\specs\\screenshots\\home-1.png and ./out/report.pdf\nsee https://example.com/a.png')])
    expect(list.map((a) => [a.name, a.kind, a.origin])).toEqual([
      ['report.pdf', 'pdf', 'saved'],
      ['home-1.png', 'image', 'saved'],
    ])
  })
  it('finds dev servers and Claude artifact links, not other addresses', () => {
    const list = artifactsOf([
      bash('Local: http://localhost:5173/, Network: http://0.0.0.0:3000'),
      text('Preview: https://claude.ai/public/artifacts/abc-123 and https://example.com/docs.'),
    ])
    expect(list.map((a) => a.target)).toEqual(['https://claude.ai/public/artifacts/abc-123', 'http://localhost:3000/', 'http://localhost:5173/'])
    expect(list.every((a) => a.kind === 'url' && a.origin === 'link')).toBe(true)
  })
  it('keeps any address a browser tool navigated to', () => {
    const list = artifactsOf([tool('mcp__foreman-browser__browser_navigate', { url: 'https://example.com/page' })])
    expect(list.map((a) => a.target)).toEqual(['https://example.com/page'])
  })
  it('takes a screenshot tool file name', () => {
    const list = artifactsOf([tool('mcp__x__browser_take_screenshot', { filename: 'docs/shot.png' })])
    expect(list.map((a) => [a.target, a.kind])).toEqual([['docs/shot.png', 'image']])
  })
  it('lists each once, newest first, a later mention moves it up', () => {
    const list = artifactsOf([
      tool('Write', { file_path: 'C:\\p\\a.html' }),
      tool('Write', { file_path: '/p/b.html' }),
      tool('Write', { file_path: 'c:/p/a.html' }),
    ])
    expect(list.map((a) => a.name)).toEqual(['a.html', 'b.html'])
    expect(list[0]!.target).toBe('c:/p/a.html')
  })
})

describe('capArtifacts', () => {
  const list = artifactsOf(Array.from({ length: 8 }, (_, i) => tool('Write', { file_path: `/p/f${i}.html` })))
  it('caps at five with the rest counted, and shows all on request', () => {
    expect(capArtifacts(list, false)).toMatchObject({ more: 3 })
    expect(capArtifacts(list, false).shown).toHaveLength(5)
    expect(capArtifacts(list, true)).toEqual({ shown: list, more: 0 })
    expect(capArtifacts(list.slice(0, 5), false).more).toBe(0)
  })
})
