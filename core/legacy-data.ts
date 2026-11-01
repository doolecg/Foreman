import { cpSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir, type PathEnv } from './paths'

// Operant 3 kept its data in an app-data folder called 'Operant2'. Foreman uses 'Foreman'.
export const LEGACY_APP_NAME = 'Operant2'

export function legacyDataDir(e: PathEnv): string {
  return appDataDir({ ...e, env: { ...e.env, FOREMAN_DATA_DIR: undefined } }, LEGACY_APP_NAME)
}

export type LegacyCopy = 'copied' | 'not-needed' | 'no-old-data'

// Copies the old Operant data folder to the new one the first time Foreman starts. The old folder is left as it was.
// The database file is renamed in the copy only.
export function copyLegacyData(oldDir: string, newDir: string): LegacyCopy {
  if (existsSync(newDir) && readdirSync(newDir).length > 0) return 'not-needed'
  if (!existsSync(oldDir)) return 'no-old-data'
  cpSync(oldDir, newDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const from = join(newDir, `operant.db${suffix}`)
    if (existsSync(from)) renameSync(from, join(newDir, `foreman.db${suffix}`))
  }
  return 'copied'
}
