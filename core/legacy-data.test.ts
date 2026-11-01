import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyLegacyData, legacyDataDir } from './legacy-data'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'foreman-legacy-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('legacy data copy', () => {
  it('copies the old folder, renames the database in the copy and leaves the original alone', () => {
    const oldDir = join(root, 'Operant2')
    mkdirSync(join(oldDir, 'backups'), { recursive: true })
    writeFileSync(join(oldDir, 'operant.db'), 'db')
    writeFileSync(join(oldDir, 'operant.db-wal'), 'wal')
    writeFileSync(join(oldDir, 'backups', 'a.json'), '{}')
    const newDir = join(root, 'Foreman')
    expect(copyLegacyData(oldDir, newDir)).toBe('copied')
    expect(readFileSync(join(newDir, 'foreman.db'), 'utf8')).toBe('db')
    expect(readFileSync(join(newDir, 'foreman.db-wal'), 'utf8')).toBe('wal')
    expect(existsSync(join(newDir, 'operant.db'))).toBe(false)
    expect(existsSync(join(newDir, 'backups', 'a.json'))).toBe(true)
    expect(readFileSync(join(oldDir, 'operant.db'), 'utf8')).toBe('db')
  })

  it('does nothing when Foreman already has data or there is no old folder', () => {
    const oldDir = join(root, 'Operant2')
    const newDir = join(root, 'Foreman')
    expect(copyLegacyData(oldDir, newDir)).toBe('no-old-data')
    mkdirSync(oldDir)
    mkdirSync(newDir)
    writeFileSync(join(newDir, 'foreman.db'), 'new')
    expect(copyLegacyData(oldDir, newDir)).toBe('not-needed')
    expect(readFileSync(join(newDir, 'foreman.db'), 'utf8')).toBe('new')
  })

  it('finds the old folder under the app-data directory', () => {
    const old = legacyDataDir({ platform: 'win32', home: 'home', env: { APPDATA: 'roaming', FOREMAN_DATA_DIR: 'dev' } })
    expect(old).toBe(join('roaming', 'Operant2'))
  })
})
