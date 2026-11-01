import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packStatus, resetPack, syncPack } from './engineering'

let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'op-eng-'))
  dirs.push(root)
  const builtin = join(root, 'builtin')
  const user = join(root, 'user')
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(builtin, rel)), { recursive: true })
    writeFileSync(join(builtin, rel), text)
  }
  put('engineering/.claude-plugin/plugin.json', '{"name":"foreman-engineering"}')
  put('engineering/skills/flow/SKILL.md', 'flow v1')
  put('factory/skills/factory/SKILL.md', 'factory v1')
  const read = (rel: string) => readFileSync(join(user, rel), 'utf8')
  return { builtin, user, put, read }
}

describe('engineering pack', () => {
  it('copies both plugin folders and writes a manifest on first sync', () => {
    const { builtin, user, read } = setup()
    syncPack(builtin, user)
    expect(read('engineering/skills/flow/SKILL.md')).toBe('flow v1')
    expect(read('engineering/.claude-plugin/plugin.json')).toContain('foreman-engineering')
    expect(read('factory/skills/factory/SKILL.md')).toBe('factory v1')
    const manifest = JSON.parse(read('.manifest.json'))
    expect(Object.keys(manifest).sort()).toEqual(['engineering/.claude-plugin/plugin.json', 'engineering/skills/flow/SKILL.md', 'factory/skills/factory/SKILL.md'])
    expect(packStatus(user)).toEqual({ edited: [] })
  })

  it('updates a file the user never edited and copies new files', () => {
    const { builtin, user, put, read } = setup()
    syncPack(builtin, user)
    put('engineering/skills/flow/SKILL.md', 'flow v2')
    put('engineering/skills/spec/SKILL.md', 'spec v1')
    syncPack(builtin, user)
    expect(read('engineering/skills/flow/SKILL.md')).toBe('flow v2')
    expect(read('engineering/skills/spec/SKILL.md')).toBe('spec v1')
    expect(packStatus(user)).toEqual({ edited: [] })
  })

  it('leaves an edited file alone and lists it', () => {
    const { builtin, user, put, read } = setup()
    syncPack(builtin, user)
    writeFileSync(join(user, 'engineering/skills/flow/SKILL.md'), 'my flow')
    put('engineering/skills/flow/SKILL.md', 'flow v2')
    put('factory/skills/factory/SKILL.md', 'factory v2')
    syncPack(builtin, user)
    expect(read('engineering/skills/flow/SKILL.md')).toBe('my flow')
    expect(read('factory/skills/factory/SKILL.md')).toBe('factory v2')
    expect(packStatus(user)).toEqual({ edited: ['engineering/skills/flow/SKILL.md'] })
  })

  it('restores a deleted file', () => {
    const { builtin, user, read } = setup()
    syncPack(builtin, user)
    rmSync(join(user, 'factory/skills/factory/SKILL.md'))
    syncPack(builtin, user)
    expect(read('factory/skills/factory/SKILL.md')).toBe('factory v1')
  })

  it('reset backs up edited files, overwrites everything and clears the status', () => {
    const { builtin, user, read } = setup()
    syncPack(builtin, user)
    writeFileSync(join(user, 'engineering/skills/flow/SKILL.md'), 'my flow')
    const { backup } = resetPack(builtin, user, 1234)
    expect(backup).toBe(join(user, '.backup-1234'))
    expect(readFileSync(join(backup!, 'engineering/skills/flow/SKILL.md'), 'utf8')).toBe('my flow')
    expect(read('engineering/skills/flow/SKILL.md')).toBe('flow v1')
    expect(packStatus(user)).toEqual({ edited: [] })
  })

  it('reset makes no backup folder when nothing was edited', () => {
    const { builtin, user } = setup()
    syncPack(builtin, user)
    expect(resetPack(builtin, user, 1).backup).toBeNull()
    expect(readdirSync(user).some((n) => n.startsWith('.backup-'))).toBe(false)
    expect(existsSync(join(user, '.manifest.json'))).toBe(true)
  })

  it('reports no edits for an empty folder', () => {
    const { user } = setup()
    expect(packStatus(user)).toEqual({ edited: [] })
  })
})
