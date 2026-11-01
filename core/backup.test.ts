import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../shared/settings'
import { AUTO_PREFIX, KEEP_AUTO, buildBackup, listBackups, pruneAuto, sha256, stripSecrets, verifyBackup, writeBackup } from './backup'
import { Ops } from './ops'
import { Store } from './store'

describe('backup bundle', () => {
  it('drops credentials wherever they sit and keeps the settings sections', () => {
    const b = buildBackup({ 'settings.json': { tokens: { capWarnPct: 80 }, remote: { mode: 'remote', apiKey: 'sk-secret', url: 'http://h' }, authorization: 'Bearer x' } }, 'test', 1)
    const text = b.files['settings.json']!
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('Bearer')
    expect(JSON.parse(text)).toEqual({ tokens: { capWarnPct: 80 }, remote: { mode: 'remote', url: 'http://h' } })
    expect(stripSecrets({ password: 'p', name: 'n' })).toEqual({ name: 'n' })
  })

  it('verifies every checksum and refuses a changed part', () => {
    const b = buildBackup({ 'settings.json': { dailyBudgetUsd: 7 }, 'presets.json': [] }, 'test', 1)
    expect(verifyBackup(JSON.stringify(b)).parts).toEqual({ 'settings.json': { dailyBudgetUsd: 7 }, 'presets.json': [] })
    const tampered = JSON.parse(JSON.stringify(b))
    tampered.files['settings.json'] = tampered.files['settings.json'].replace('7', '9')
    expect(() => verifyBackup(JSON.stringify(tampered))).toThrow(/Checksum mismatch in settings.json/)
    expect(() => verifyBackup('{"format":"other"}')).toThrow(/not a Foreman backup/)
    expect(() => verifyBackup('not json')).toThrow(/not valid JSON/)
  })

  it('keeps only the newest five automatic snapshots and never prunes a manual backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foreman-prune-'))
    try {
      for (let i = 0; i < 7; i++) writeBackup(dir, buildBackup({ 'settings.json': { i } }, 'auto', Date.UTC(2026, 0, 1 + i)), AUTO_PREFIX)
      writeBackup(dir, buildBackup({ 'settings.json': {} }, 'manual', Date.UTC(2025, 0, 1)))
      const removed = pruneAuto(dir)
      expect(removed).toHaveLength(7 - KEEP_AUTO)
      const left = listBackups(dir)
      expect(left.filter((e) => e.kind === 'pre-update')).toHaveLength(KEEP_AUTO)
      expect(left.filter((e) => e.kind === 'manual')).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('backup and restore through the app services', () => {
  let store: Store
  let dir: string
  let settings: Settings
  let ops: Ops
  let clock = 0

  beforeEach(() => {
    store = new Store(':memory:')
    store.createCrew('shop', '/code/shop')
    clock = Date.UTC(2026, 9, 9, 10)
    dir = mkdtempSync(join(tmpdir(), 'foreman-backup-'))
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, dailyBudgetUsd: 7 })
    ops = new Ops({
      store,
      settings: () => settings,
      saveSettings: (next) => (settings = next),
      backupDir: dir,
      claudeDir: join(dir, 'no-claude'),
      now: () => clock,
    })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('create, mutate, restore, compare: the restored state matches the backup', async () => {
    const kept = store.createPreset({ name: 'keep me', agent: 'claude', model: '', permissionMode: 'default', roleText: 'Keep this text.' })
    const before = { settings: structuredClone(settings) }
    const entry = ops.createBackup('before')
    expect(entry.name.startsWith('foreman-backup-')).toBe(true)
    expect(readdirSync(dir)).toContain(entry.name)

    // mutate: settings change, a preset is removed and renamed text, a team is added
    settings = sanitizeSettings({ ...settings, dailyBudgetUsd: 0 })
    store.deletePreset(kept.id)
    store.createPreset({ name: 'intruder', agent: 'claude', model: '', permissionMode: 'default' })
    store.createTeam({ name: 'extra team', rules: '', description: '' })

    const applied = await ops.restoreBackup(entry.name, true)
    expect(applied).toEqual(['settings.json', 'presets.json', 'teams.json'])
    expect(settings).toEqual(before.settings)
    expect(store.listPresets().map((p) => [p.name, p.roleText]).filter(([n]) => n === 'keep me')).toEqual([['keep me', 'Keep this text.']])
    expect(store.listPresets().some((p) => p.name === 'intruder')).toBe(false)
    expect(store.listTeams().some((t) => t.name === 'extra team')).toBe(false)
  })

  it('still restores a backup from an older version that holds a learn.json part, and skips that part', async () => {
    const old = buildBackup({ 'settings.json': { dailyBudgetUsd: 7 } }, 'old', 1)
    const learnText = JSON.stringify({ lessons: [], drafts: [], changes: [] })
    old.files['learn.json'] = learnText
    old.manifest.files['learn.json'] = { sha256: sha256(learnText), bytes: Buffer.byteLength(learnText, 'utf8') }
    writeFileSync(join(dir, 'foreman-backup-old.json'), JSON.stringify(old))
    expect(await ops.restoreBackup('foreman-backup-old.json', true)).toEqual(['settings.json'])
  })

  it('restores a backup whose settings still hold the old hindsight and codegraph keys, and drops them', async () => {
    const old = buildBackup({ 'settings.json': { dailyBudgetUsd: 7, hindsightUrl: 'http://nas:9077', hindsight: { mode: 'remote', url: 'http://nas:9077' }, codegraph: true } }, 'old', 1)
    writeFileSync(join(dir, 'foreman-backup-old2.json'), JSON.stringify(old))
    expect(await ops.restoreBackup('foreman-backup-old2.json', true)).toEqual(['settings.json'])
    expect(settings.dailyBudgetUsd).toBe(7)
    expect('hindsight' in settings).toBe(false)
    expect('hindsightUrl' in settings).toBe(false)
  })

  it('refuses a restore that was not confirmed, and changes nothing', async () => {
    const entry = ops.createBackup()
    settings = sanitizeSettings({ ...settings, dailyBudgetUsd: 3 })
    await expect(ops.restoreBackup(entry.name, false)).rejects.toThrow(/confirm/)
    expect(settings.dailyBudgetUsd).toBe(3)
  })

  it('refuses a backup whose checksum no longer matches, and restores nothing from it', async () => {
    const entry = ops.createBackup()
    const path = join(dir, entry.name)
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    doc.files['settings.json'] = doc.files['settings.json'].replace('"dailyBudgetUsd": 7', '"dailyBudgetUsd": 99')
    writeFileSync(path, JSON.stringify(doc))
    settings = sanitizeSettings({ ...settings, dailyBudgetUsd: 3 })
    await expect(ops.restoreBackup(entry.name, true)).rejects.toThrow(/Checksum mismatch in settings.json/)
    expect(settings.dailyBudgetUsd).toBe(3)
  })

  it('a pre-update snapshot is listed as such and the newest five are kept', () => {
    for (let i = 0; i < 6; i++) {
      clock = Date.UTC(2026, 9, 1 + i)
      ops.snapshotBeforeUpdate('3.0.4')
    }
    const autos = listBackups(dir).filter((e) => e.kind === 'pre-update')
    expect(autos).toHaveLength(KEEP_AUTO)
    expect(existsSync(autos[0]!.path)).toBe(true)
  })

  it('deletes a backup by name, and only one it lists', () => {
    const entry = ops.createBackup()
    ops.deleteBackup(entry.name)
    expect(ops.listBackups()).toHaveLength(0)
    expect(() => ops.deleteBackup('../../etc/passwd.json')).toThrow()
  })
})
