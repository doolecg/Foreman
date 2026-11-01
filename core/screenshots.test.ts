import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SHOT_IMAGE_MAX, saveScreenshot, shotKind } from './screenshots'

describe('saveScreenshot', () => {
  let root: string
  let project: string
  let src: string
  const now = new Date(2026, 9, 11, 13, 5, 9).getTime()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'foreman-shots-'))
    project = join(root, 'proj')
    mkdirSync(project)
    src = join(root, 'a.png')
    writeFileSync(src, Buffer.from('png-bytes'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reduces the kind to [a-z0-9-], 40 characters, default shot', () => {
    expect(shotKind('Login Page!')).toBe('login-page')
    expect(shotKind('')).toBe('shot')
    expect(shotKind(undefined)).toBe('shot')
    expect(shotKind('x'.repeat(60))).toHaveLength(40)
  })

  it('copies into docs/specs/screenshots with a stamped name and a gitignore', () => {
    const r = saveScreenshot({ projectDir: project, kind: 'Login', file: src, now })
    expect(r.relPath).toBe('docs/specs/screenshots/login-20261011-130509.png')
    expect(readFileSync(r.path).toString()).toBe('png-bytes')
    expect(readFileSync(join(project, 'docs', 'specs', 'screenshots', '.gitignore'), 'utf8')).toBe('*\n')
    expect(r.image?.mediaType).toBe('image/png')
    expect(r.image?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('adds -2, -3 when the name is taken', () => {
    const a = saveScreenshot({ projectDir: project, file: src, now })
    const b = saveScreenshot({ projectDir: project, file: src, now })
    const c = saveScreenshot({ projectDir: project, file: src, now })
    expect([a, b, c].map((r) => basename(r.path))).toEqual(['shot-20261011-130509.png', 'shot-20261011-130509-2.png', 'shot-20261011-130509-3.png'])
  })

  it('keeps a file that is already inside the folder', () => {
    const dir = join(project, 'docs', 'specs', 'screenshots')
    mkdirSync(dir, { recursive: true })
    const inner = join(dir, 'mine.png')
    writeFileSync(inner, 'x')
    const r = saveScreenshot({ projectDir: project, file: inner, now })
    expect(r.path).toBe(inner)
    expect(r.relPath).toBe('docs/specs/screenshots/mine.png')
  })

  it('rejects relative paths and other extensions', () => {
    expect(() => saveScreenshot({ projectDir: project, file: 'a.png', now })).toThrow(/absolute/)
    const txt = join(root, 'a.txt')
    writeFileSync(txt, 'x')
    expect(() => saveScreenshot({ projectDir: project, file: txt, now })).toThrow(/png/)
  })

  it('returns no image when the base64 is over the cutoff', () => {
    const big = join(root, 'big.webp')
    writeFileSync(big, Buffer.alloc(Math.ceil((SHOT_IMAGE_MAX * 3) / 4) + 10))
    const r = saveScreenshot({ projectDir: project, file: big, now })
    expect(r.image).toBeNull()
    expect(readFileSync(r.path).length).toBeGreaterThan(0)
  })
})
