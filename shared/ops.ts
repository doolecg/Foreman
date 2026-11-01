// Result shapes for the backup, superpowers and preset-file calls. Core builds them; the renderer reads them.

export type BackupPartName = 'settings.json' | 'presets.json' | 'teams.json'

export interface BackupEntry {
  name: string
  path: string
  bytes: number
  modified: number
  kind: 'manual' | 'pre-update'
}

export interface SuperpowersStatus {
  installed: boolean
  path?: string
  version?: string
}

export interface PresetFileEntry {
  name: string
  agent: string
  model: string
  effort: string
  permissionMode: string
  tools: string
  allow: string[]
  deny: string[]
  cacheTtl: string
  contextCap: number
  roleText: string | null
}

export interface PresetImportItem {
  name: string
  action: 'add' | 'skip' | 'invalid'
  reason: string
  // The values to create, for an add.
  input: PresetFileEntry | null
}
