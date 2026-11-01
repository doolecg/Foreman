import { pbkdf2Sync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runHidden } from '../proc'
import { chromiumEpochToSeconds, decryptAesCbc, decryptAesGcm, readChromiumRows, valueVersion, windowsWrappedKey, type ChromiumRow } from './chromium'
import { detectDefaultBrowser, profileLabel, type BrowserTarget, type Run } from './detect'
import { readFirefoxCookies } from './firefox'
import type { CookieImportPreview, CookieReadResult, RawCookie } from './types'

export type { CookieImportPreview, CookieImportResult, CookieReadResult, RawCookie } from './types'

// Runs a command hidden and quietly (never logged: these carry local file paths and, for the key step, secret
// material through the environment, never the argument list).
const run: Run = (cmd, args) => runHidden(cmd, args, { quiet: true }).then((r) => r.stdout)

// Unprotects a Chromium DPAPI-wrapped key on Windows and returns the 32-byte AES key. The wrapped key goes in through
// the environment, and the result stays in memory; neither is logged.
async function windowsUnprotect(wrapped: Buffer): Promise<Buffer | null> {
  const script =
    'Add-Type -AssemblyName System.Security;' +
    '$b=[Convert]::FromBase64String($env:FOREMAN_DPAPI_B64);' +
    "$k=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    '[Convert]::ToBase64String($k)'
  const res = await runHidden('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    quiet: true,
    env: { ...process.env, FOREMAN_DPAPI_B64: wrapped.toString('base64') },
  })
  const out = res.stdout.trim()
  if (!out) return null
  const key = Buffer.from(out, 'base64')
  return key.length === 32 ? key : null
}

// The macOS Keychain password for a Chromium browser's "Safe Storage". Reading it shows a system permission prompt.
async function macSafeStoragePassword(browser: string): Promise<string> {
  const service = `${browser} Safe Storage`
  const res = await runHidden('security', ['find-generic-password', '-w', '-s', service], { quiet: true })
  return res.stdout.trim()
}

// Decrypts every Chromium row with the platform key. v20 (app-bound, Chrome 127+/Edge) cannot be read without
// elevation and is counted as locked. Values are never logged.
async function decryptChromiumRows(rows: ChromiumRow[], target: BrowserTarget, platform: NodeJS.Platform): Promise<{ cookies: RawCookie[]; locked: number }> {
  const cookies: RawCookie[] = []
  let locked = 0

  // Build the decrypt function for this platform.
  let gcmKey: Buffer | null = null
  let cbcKey: Buffer | null = null
  if (platform === 'win32') {
    const localState = target.userDataDir ? join(target.userDataDir, 'Local State') : ''
    const wrapped = localState && existsSync(localState) ? windowsWrappedKey(localState) : null
    gcmKey = wrapped ? await windowsUnprotect(wrapped) : null
  } else if (platform === 'darwin') {
    const pw = await macSafeStoragePassword(target.name)
    if (pw) cbcKey = pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1')
  } else {
    // Linux: the "peanuts" fallback (v10). v11 (libsecret) is not read here and its cookies are reported as locked.
    cbcKey = pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')
  }

  for (const r of rows) {
    let value: string | null = null
    if (r.encrypted.length === 0) {
      value = r.plain
    } else {
      const version = valueVersion(r.encrypted)
      try {
        if (version === 'v20') {
          locked++
          continue
        } else if (platform === 'win32' && (version === 'v10' || version === 'v11')) {
          value = gcmKey ? decryptAesGcm(r.encrypted, gcmKey) : null
        } else if (platform === 'darwin' && version === 'v10') {
          value = cbcKey ? decryptAesCbc(r.encrypted, cbcKey) : null
        } else if (platform === 'linux' && version === 'v10') {
          value = cbcKey ? decryptAesCbc(r.encrypted, cbcKey) : null
        } else {
          // Legacy per-value DPAPI (old Windows Chrome) or Linux v11 (libsecret): not read here.
          value = null
        }
      } catch {
        value = null
      }
    }
    if (value === null) {
      locked++
      continue
    }
    cookies.push({
      host: r.host,
      name: r.name,
      value,
      path: r.path,
      secure: r.secure,
      httpOnly: r.httpOnly,
      sameSite: r.sameSite,
      expires: chromiumEpochToSeconds(r.expiresUtc),
    })
  }
  return { cookies, locked }
}

function lockedReason(browser: string, locked: number): string | undefined {
  if (locked <= 0) return undefined
  return `${browser} locks ${locked} ${locked === 1 ? 'cookie' : 'cookies'} so only ${browser} can read ${locked === 1 ? 'it' : 'them'}.`
}

// Reads the OS default browser's cookies from its default profile. Values are kept in the returned result and must
// never cross IPC or reach a log. Best effort: an unsupported or missing browser comes back with supported=false.
export async function readDefaultBrowserCookies(platform: NodeJS.Platform = process.platform): Promise<CookieReadResult> {
  let target: BrowserTarget
  try {
    target = await detectDefaultBrowser(run, platform)
  } catch {
    return { supported: false, browser: '', profile: '', cookies: [], locked: 0, needsClose: false, reason: 'Could not read your default browser.' }
  }
  if (target.engine === 'unsupported') {
    return { supported: false, browser: '', profile: '', cookies: [], locked: 0, needsClose: false, reason: target.reason }
  }
  const profile = profileLabel(target.profileDir)
  try {
    if (target.engine === 'firefox') {
      const cookies = await readFirefoxCookies(target.profileDir)
      return { supported: true, browser: target.name, profile, cookies, locked: 0, needsClose: false }
    }
    const rows = await readChromiumRows(target.profileDir)
    const { cookies, locked } = await decryptChromiumRows(rows, target, platform)
    return { supported: true, browser: target.name, profile, cookies, locked, needsClose: false, reason: lockedReason(target.name, locked) }
  } catch {
    // The usual cause is the store being locked because the browser is open and the copy failed.
    return { supported: true, browser: target.name, profile, cookies: [], locked: 0, needsClose: true, reason: `Close ${target.name} and try again.` }
  }
}

// Counts only, for the confirm dialog. Never returns a cookie value or name.
export function previewOf(result: CookieReadResult): CookieImportPreview {
  return {
    supported: result.supported,
    browser: result.browser,
    profile: result.profile,
    found: result.cookies.length,
    locked: result.locked,
    needsClose: result.needsClose,
    ...(result.reason ? { reason: result.reason } : {}),
  }
}
