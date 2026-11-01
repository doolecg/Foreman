import { basename } from 'node:path'
import type { Preset, Team, ExportText } from '../shared/types'
import type { Settings } from '../shared/settings'
import { sanitizeSettings } from '../shared/settings'
import type { BackupEntry, BackupPartName, PresetImportItem, SuperpowersStatus } from '../shared/ops'
import { AUTO_PREFIX, MANUAL_PREFIX, buildBackup, deleteBackup, listBackups, pruneAuto, readBackupFile, restoreBackup, writeBackup } from './backup'
import { detectSuperpowers } from './superpowers'
import { exportPresets, parsePresetFile } from './preset-files'
import type { Store } from './store'

// The calls the backup, superpowers and preset-file handlers need from the app.
export interface OpsDeps {
  store: Store
  settings: () => Settings
  saveSettings: (next: Settings) => Settings
  backupDir: string
  claudeDir: string
  now: () => number
  log?: (kind: string, message: string) => void
}

export class OpsError extends Error {}

const bad = (m: string) => new OpsError(m)

export class Ops {
  constructor(private readonly d: OpsDeps) {}

  // Backup

  // The whole backup: settings (secrets never), presets and teams.
  private bundle(label: string) {
    const d = this.d
    return buildBackup(
      {
        'settings.json': d.settings(),
        'presets.json': d.store.listPresets(),
        'teams.json': d.store.listTeams(),
      },
      label,
      d.now(),
    )
  }

  createBackup(label = ''): { name: string; path: string; bytes: number } {
    const path = writeBackup(this.d.backupDir, this.bundle(label || 'Manual backup'), MANUAL_PREFIX)
    const bytes = readBackupFile(this.d.backupDir, basename(path)).length
    this.d.log?.('backup', `Backup created: ${basename(path)}`)
    return { name: basename(path), path, bytes }
  }

  // Called by the updater before it installs: keeps the newest five automatic snapshots.
  snapshotBeforeUpdate(toVersion: string): string {
    const path = writeBackup(this.d.backupDir, this.bundle(`Before the update to ${toVersion}`), AUTO_PREFIX)
    const removed = pruneAuto(this.d.backupDir)
    this.d.log?.('backup', `Snapshot before update to ${toVersion}: ${basename(path)}${removed.length ? `; removed ${removed.length} older` : ''}`)
    return path
  }

  listBackups(): BackupEntry[] {
    return listBackups(this.d.backupDir)
  }

  // Verifies the file first. Refused without confirm; a checksum mismatch changes nothing.
  async restoreBackup(name: string, confirm: boolean): Promise<BackupPartName[]> {
    if (confirm !== true) throw bad('Restoring replaces your settings, presets and teams: confirm it first')
    const text = readBackupFile(this.d.backupDir, name)
    const d = this.d
    const applied = await restoreBackup(text, {
      'settings.json': (v) => {
        d.saveSettings(sanitizeSettings(v))
      },
      'presets.json': (v) => this.restorePresets(v as Preset[]),
      'teams.json': (v) => this.restoreTeams(v as Team[]),
    })
    d.log?.('backup', `Restored ${basename(name)}: ${applied.join(', ')}`)
    return applied as BackupPartName[]
  }

  deleteBackup(name: string): void {
    deleteBackup(this.d.backupDir, name)
  }

  // Built-ins are matched by their key and get their values back; user presets are matched by name, and a user
  // preset the backup does not hold is removed.
  private restorePresets(list: Preset[]): void {
    const { store } = this.d
    const keep = new Set<number>()
    for (const p of list) {
      const values = { name: p.name, agent: p.agent, model: p.model, effort: p.effort, permissionMode: p.permissionMode, tools: p.tools, allow: p.allow, deny: p.deny, cacheTtl: p.cacheTtl, contextCap: p.contextCap, roleText: p.roleText }
      const existing = p.builtin ? store.getPresetByBuiltin(p.builtin) : store.listPresets().find((x) => x.builtin == null && x.name === p.name)
      if (existing) {
        keep.add(existing.id)
        store.updatePreset(existing.id, values as Parameters<Store['updatePreset']>[1])
      } else if (!p.builtin) {
        keep.add(store.createPreset(values as Parameters<Store['createPreset']>[0]).id)
      }
    }
    for (const p of store.listPresets()) if (p.builtin == null && !keep.has(p.id)) store.deletePreset(p.id)
  }

  private restoreTeams(list: Team[]): void {
    const { store } = this.d
    const keep = new Set<number>()
    for (const t of list) {
      const existing = t.builtin ? store.listTeams().find((x) => x.builtin === t.builtin) : store.listTeams().find((x) => x.builtin == null && x.name === t.name)
      if (existing) {
        keep.add(existing.id)
        store.updateTeam(existing.id, { name: t.name, rules: t.rules, description: t.description })
      } else if (!t.builtin) {
        keep.add(store.createTeam({ name: t.name, rules: t.rules, description: t.description }).id)
      }
    }
    for (const t of store.listTeams()) if (t.builtin == null && !keep.has(t.id)) store.deleteTeam(t.id)
  }

  // Superpowers

  superpowers(): SuperpowersStatus {
    return detectSuperpowers(this.d.claudeDir)
  }

  // Preset files

  presetExport(presetId?: number): ExportText {
    const { store } = this.d
    if (presetId == null) return exportPresets(store.listPresets())
    const p = store.getPreset(presetId)
    if (!p) throw bad(`Preset ${presetId} not found`)
    return exportPresets([p])
  }

  presetPreview(text: string): PresetImportItem[] {
    return parsePresetFile(text, this.d.store.listPresets().map((p) => p.name))
  }

  // Adds the presets a file holds that are not here yet; the rest are reported, not changed.
  presetImport(text: string): PresetImportItem[] {
    const items = this.presetPreview(text)
    for (const it of items) {
      if (it.action !== 'add' || !it.input) continue
      this.d.store.createPreset(it.input as Parameters<Store['createPreset']>[0])
      this.d.log?.('preset', `Preset ${it.name} imported`)
    }
    return items
  }
}
