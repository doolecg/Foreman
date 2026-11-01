// Auto-update from GitHub releases: check at startup and every few hours, download the installer for
// this system in the background, then install on click (with relaunch) or when the app quits.
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app, net } from 'electron'
import {
  APP_BUNDLES,
  appImageInstallScript,
  checkIntervalMs,
  debInstallScript,
  downloaded,
  EXT,
  installKind,
  macInstallScript,
  msiWorkerScript,
  newer,
  pickAsset,
  pickRelease,
  UPDATE_LOCK,
  UPDATE_REPO,
  UPDATE_RESULT,
  updateFailureMessage,
  updateRunning,
  verifyDigest,
  type InstallKind,
  type Release,
  type ReleaseAsset,
} from '../core/update'
import type { Settings } from '../shared/settings'
import type { UpdateStatus } from '../shared/types'

interface Ready {
  version: string
  file: string
  notes: string
  url?: string
  kind: InstallKind
}

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/

const HEADERS = { 'User-Agent': 'foreman', Accept: 'application/vnd.github+json' }

const lockFile = () => join(tmpdir(), UPDATE_LOCK)
const resultFile = () => join(tmpdir(), UPDATE_RESULT)
const installLog = (version: string) => join(tmpdir(), `Foreman-${version}-install.log`)

// True while an update worker is installing (Windows), so a second copy must not start or install.
export function updateInstalling(): boolean {
  let lock: { text: string; mtimeMs: number } | null = null
  try {
    lock = { text: readFileSync(lockFile(), 'utf8'), mtimeMs: statSync(lockFile()).mtimeMs }
  } catch {
    return false
  }
  return updateRunning(lock, (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  })
}

// The last install's result, read once and removed: a message when it did not install.
function lastFailure(currentVersion: string): string | undefined {
  try {
    const text = readFileSync(resultFile(), 'utf8')
    unlinkSync(resultFile())
    const version = /^(\S+)/.exec(text.trim())?.[1] ?? ''
    return updateFailureMessage(text, currentVersion, installLog(version)) ?? undefined
  } catch {
    return undefined
  }
}

export function createUpdater({
  send,
  getSettings,
  beforeInstall,
}: {
  send: (s: UpdateStatus) => void
  getSettings: () => Settings
  // Runs before an install starts (the app takes a backup snapshot here). A failure is logged and never blocks the update.
  beforeInstall?: (version: string) => unknown
}) {
  const currentVersion = app.getVersion()
  const enabled = app.isPackaged || process.env.FOREMAN_UPDATE_TEST === '1'
  let ready: Ready | null = null
  let busy = false
  let installing = false
  let timer: NodeJS.Timeout | null = null
  let info: Pick<UpdateStatus, 'checkedAt' | 'latest'> = {}
  // Why the last install did not go in, shown with the ready update until the next install starts.
  let failure = enabled ? lastFailure(currentVersion) : undefined
  let status: UpdateStatus = enabled
    ? { state: 'idle', currentVersion }
    : { state: 'unsupported', currentVersion, message: 'Updates run in installed builds only' }

  const report = (s: Omit<UpdateStatus, 'currentVersion'>) => {
    status = { ...info, ...s, currentVersion }
    send(status)
  }

  // Needs twice the download free in its folder (the file, then room to install from).
  function checkDiskSpace(dir: string, size: number, version: string): void {
    let free: number
    try {
      const st = statfsSync(dir)
      free = Number(st.bavail) * Number(st.bsize)
    } catch {
      return
    }
    if (!Number.isFinite(free) || free >= size * 2) return
    const mb = (n: number) => Math.ceil(n / 1_048_576)
    throw new Error(`Not enough disk space to download Foreman ${version} (needs ${mb(size * 2)} MB, ${mb(free)} MB free)`)
  }

  async function fetchAsset(asset: ReleaseAsset, version: string, kind: InstallKind, onDownload: () => void): Promise<string> {
    // A per-user folder, not the shared temp folder: on Linux another user could plant a file in /tmp.
    const dir = join(app.getPath('userData'), 'updates')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `Foreman-${version}.${EXT[kind]}`)
    // Only the newest download is kept.
    for (const name of readdirSync(dir)) if (join(dir, name) !== file) rmSync(join(dir, name), { force: true, recursive: true })
    if (!downloaded(file, asset.size)) {
      checkDiskSpace(dir, asset.size, version)
      onDownload()
      const part = `${file}.part`
      try {
        const res = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'foreman' } })
        if (!res.ok || !res.body) throw new Error(`download ${res.status}`)
        await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(part))
        if (statSync(part).size !== asset.size) throw new Error('download size mismatch')
        renameSync(part, file)
      } catch (err) {
        try {
          unlinkSync(part)
        } catch {
          /* nothing to clean */
        }
        throw err
      }
    }
    try {
      if (!(await verifyDigest(file, asset.digest))) throw new Error(`${version} has no checksum to check the download against`)
    } catch (err) {
      unlinkSync(file)
      throw err
    }
    return file
  }

  async function check(): Promise<void> {
    if (!enabled || busy || installing) return
    busy = true
    report({ state: 'checking' })
    try {
      const channel = getSettings().updates.channel
      info = { ...info, checkedAt: Date.now() }
      const url = `https://api.github.com/repos/${UPDATE_REPO}/releases${channel === 'beta' ? '?per_page=10' : '/latest'}`
      const res = await net.fetch(url, { headers: HEADERS })
      if (res.status === 404) {
        report({ state: 'current', message: 'No releases published yet' })
        return
      }
      if (!res.ok) throw new Error(`GitHub API ${res.status}`)
      const body = (await res.json()) as unknown
      const rel = channel === 'beta' ? pickRelease(body, 'beta') : (body as Release)
      if (!rel?.tag_name) throw new Error('no releases found')
      const version = rel.tag_name.replace(/^v/, '')
      // The version reaches file names and the install script: only a plain version number is accepted.
      if (!VERSION_RE.test(version)) throw new Error(`unexpected release tag ${rel.tag_name}`)
      info = { ...info, latest: version }
      if (!newer(version, currentVersion)) {
        report({ state: 'current' })
        return
      }
      const kind = installKind()
      if (!kind) {
        report({ state: 'error', version, url: rel.html_url, message: `${version} is out; get it from the releases page` })
        return
      }
      // Keep checking once one is downloaded: a stale ready update must not be installed over a newer release.
      if (ready && !newer(version, ready.version) && existsSync(ready.file)) {
        report({ state: 'ready', version: ready.version, notes: ready.notes, url: ready.url, message: failure })
        return
      }
      const asset = pickAsset(rel.assets, { platform: process.platform, arch: process.arch, kind })
      if (!asset) {
        report({ state: 'error', version, message: `${version} has no installer for this system yet` })
        return
      }
      const notes = rel.body ?? ''
      const file = await fetchAsset(asset, version, kind, () => report({ state: 'downloading', version, notes }))
      ready = { version, file, notes, url: rel.html_url, kind }
      report({ state: 'ready', version, notes, url: rel.html_url, message: failure })
    } catch (err) {
      // A failed check must not hide an update that is already downloaded and waiting to install.
      if (ready && existsSync(ready.file)) report({ state: 'ready', version: ready.version, notes: ready.notes, url: ready.url, message: failure })
      else report({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      busy = false
    }
  }

  const writable = (dir: string) => {
    try {
      accessSync(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  // Starts a worker that outlives the app, waits for it to exit, installs, and optionally relaunches.
  function startWorker(r: Ready, relaunch: boolean): boolean {
    const log = installLog(r.version)
    const fail = (message: string) => {
      report({ state: 'error', version: r.version, message })
      return false
    }

    if (r.kind === 'msi') {
      const exe = process.execPath
      // Old per-user install folder, removed by the worker once the new copy is in place (no-op if it is the same folder).
      const oldDir = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Foreman') : undefined
      const worker = msiWorkerScript({
        pid: process.pid,
        exe,
        installDir: dirname(exe),
        msi: r.file,
        log,
        relaunch,
        version: r.version,
        lock: lockFile(),
        result: resultFile(),
        oldDir,
      })
      const encoded = Buffer.from(worker, 'utf16le').toString('base64')
      // Node can't start a detached PowerShell that survives us, so a short-lived launcher starts it via Start-Process.
      const res = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'`,
        ],
        { windowsHide: true, stdio: 'ignore', timeout: 30_000 },
      )
      return res.status === 0 || fail(`couldn't start the installer (${res.error?.message ?? `exit ${res.status}`})`)
    }

    let script: string
    if (r.kind === 'dmg') {
      const bundle = resolve(process.execPath, '../../..')
      if (!APP_BUNDLES.includes(basename(bundle)) || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/'))
        return fail('Move Foreman to Applications, then update')
      if (!writable(dirname(bundle))) return fail(`Can't write to ${dirname(bundle)}; move Foreman somewhere you can write to`)
      script = macInstallScript({ pid: process.pid, dmg: r.file, bundle, log, relaunch })
    } else if (r.kind === 'appimage') {
      const target = resolve(process.env.APPIMAGE ?? '')
      if (!writable(dirname(target))) return fail(`Can't write to ${dirname(target)}; move the AppImage somewhere you can write to`)
      script = appImageInstallScript({ pid: process.pid, appImage: r.file, target, log, relaunch })
    } else {
      // dpkg needs a password prompt, which can't happen after the app has quit.
      if (!relaunch) return false
      if (spawnSync('/bin/sh', ['-c', 'command -v pkexec'], { stdio: 'ignore' }).status !== 0)
        return fail(`pkexec not found; install ${r.file} with your package manager`)
      script = debInstallScript({ pid: process.pid, deb: r.file, exe: process.execPath, log, relaunch })
    }
    const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' })
    child.on('error', (e) => report({ state: 'error', message: `couldn't start the installer (${e.message})` }))
    child.unref()
    return !!child.pid
  }

  function install(relaunch: boolean): boolean {
    if (!ready || installing) return false
    if (updateInstalling()) {
      report({ state: 'error', version: ready.version, message: 'An update is already installing; Foreman reopens when it is done' })
      return false
    }
    failure = undefined
    try {
      beforeInstall?.(ready.version)
    } catch (err) {
      console.error('Pre-update backup failed; installing anyway', err)
    }
    if (!startWorker(ready, relaunch)) return false
    installing = true
    report({ state: 'installing', version: ready.version })
    return true
  }

  function schedule(): void {
    if (timer) clearInterval(timer)
    timer = null
    const ms = checkIntervalMs(getSettings().updates.checkHours)
    if (ms > 0) timer = setInterval(() => void check(), ms)
  }

  return {
    get status() {
      return status
    },
    start(): void {
      if (!enabled) return
      setTimeout(() => void check(), 5_000)
      schedule()
      app.on('will-quit', () => {
        if (ready && ready.kind !== 'deb' && getSettings().updates.installOnQuit) install(false)
      })
    },
    check,
    // Settings changed: the interval may be different now.
    reschedule(): void {
      if (enabled) schedule()
    },
    installNow(): boolean {
      if (!install(true)) return false
      app.quit()
      return true
    },
  }
}
