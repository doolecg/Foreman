// Dev loop: build main/preload once, start the Vite renderer server, then launch Electron against it.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { build, createServer } from 'vite'

await build({ configFile: 'vite.main.config.ts', mode: 'development' })
await build({ configFile: 'vite.main.config.ts', mode: 'preload' })
// The license files Settings, General, License opens.
await import('./notices.mjs')
const server = await createServer({ configFile: 'vite.config.ts' })
await server.listen()
const url = server.resolvedUrls.local[0]

// Own data folder, so a dev run doesn't touch an installed Foreman's data.
const profile = process.env.FOREMAN_DATA_DIR ?? resolve(import.meta.dirname, '..', 'build', 'profiles', 'dev')
mkdirSync(profile, { recursive: true })

const electron = (await import('electron')).default
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url, FOREMAN_DATA_DIR: profile } })
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
