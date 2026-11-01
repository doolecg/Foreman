import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// Copies a locked cookie database (plus any -wal/-journal sidecars) to a throwaway temp folder, runs `use` on the copy,
// then deletes the whole copy. Browsers keep these files locked while running, so we never open the originals. The temp
// copy is removed in a finally block even when `use` throws.
export async function withCookieDbCopy<T>(dbFile: string, use: (copy: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'foreman-cookies-'))
  try {
    const name = basename(dbFile)
    const dest = join(dir, name)
    copyFileSync(dbFile, dest)
    for (const suffix of ['-wal', '-journal', '-shm']) {
      const side = `${dbFile}${suffix}`
      if (existsSync(side)) copyFileSync(side, join(dir, `${name}${suffix}`))
    }
    return await use(dest)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
