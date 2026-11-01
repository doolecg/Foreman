import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appImageInstallScript,
  checkIntervalMs,
  debInstallScript,
  downloaded,
  installKind,
  macInstallScript,
  msiWorkerScript,
  newer,
  pickAsset,
  pickRelease,
  shQuote,
  updateFailureMessage,
  updateRunning,
  verifyDigest,
  type ReleaseAsset,
} from './update'

const asset = (name: string): ReleaseAsset => ({ name, size: 1, browser_download_url: `https://x/${name}` })

describe('update', () => {
  it('compares versions', () => {
    expect(newer('2.0.1', '2.0.0')).toBe(true)
    expect(newer('v2.1.0', '2.0.9')).toBe(true)
    expect(newer('2.0.0', '2.0.0')).toBe(false)
    expect(newer('1.9.9', '2.0.0')).toBe(false)
    expect(newer('3.0.4-dev.7', '3.0.4-dev.6')).toBe(true)
    expect(newer('3.0.4-dev.6', '3.0.4-dev.7')).toBe(false)
    expect(newer('3.0.4', '3.0.4-dev.9')).toBe(true)
    expect(newer('3.0.4-dev.9', '3.0.4')).toBe(false)
    expect(newer('3.0.4-dev.1', '3.0.3')).toBe(true)
    expect(newer('10.0.0', '9.9.9')).toBe(true)
  })

  it('turns the check setting into an interval', () => {
    expect(checkIntervalMs(undefined)).toBe(3 * 3_600_000)
    expect(checkIntervalMs('')).toBe(3 * 3_600_000)
    expect(checkIntervalMs(0)).toBe(0)
    expect(checkIntervalMs(6)).toBe(6 * 3_600_000)
    expect(checkIntervalMs(99)).toBe(24 * 3_600_000)
  })

  it('picks the release for a channel, skipping drafts', () => {
    const list = [
      { tag_name: '2.2.0', draft: true, assets: [] },
      { tag_name: '2.1.0-beta.1', prerelease: true, assets: [] },
      { tag_name: '2.0.1', assets: [] },
      { tag_name: '2.0.0', assets: [] },
    ]
    expect(pickRelease(list, 'stable')?.tag_name).toBe('2.0.1')
    expect(pickRelease(list, 'beta')?.tag_name).toBe('2.1.0-beta.1')
    expect(pickRelease('nope', 'stable')).toBeNull()
  })

  it('knows which installer this copy can apply', () => {
    expect(installKind({ platform: 'win32' })).toBe('msi')
    expect(installKind({ platform: 'darwin' })).toBe('dmg')
    expect(installKind({ platform: 'linux', env: { APPIMAGE: '/a/O.AppImage' }, execPath: '/x' })).toBe('appimage')
    expect(installKind({ platform: 'linux', env: {}, execPath: '/opt/Operant 2/foreman' })).toBe('deb')
    expect(installKind({ platform: 'linux', env: {}, execPath: '/opt/Foreman/foreman' })).toBe('deb')
    expect(installKind({ platform: 'linux', env: {}, execPath: '/home/u/dev/electron' })).toBeNull()
  })

  it('picks the asset for the platform and architecture', () => {
    const assets = [
      'Foreman-2.0.1-windows-x64.msi',
      'Foreman-2.0.1-mac-arm64.dmg',
      'Foreman-2.0.1-mac-x64.dmg',
      'Foreman-2.0.1-linux-x86_64.AppImage',
      'Foreman-2.0.1-linux-amd64.deb',
    ].map(asset)
    const name = (o: Parameters<typeof pickAsset>[1]) => pickAsset(assets, o)?.name
    expect(name({ platform: 'win32', arch: 'x64', kind: 'msi' })).toBe('Foreman-2.0.1-windows-x64.msi')
    expect(name({ platform: 'darwin', arch: 'arm64', kind: 'dmg' })).toBe('Foreman-2.0.1-mac-arm64.dmg')
    expect(name({ platform: 'darwin', arch: 'x64', kind: 'dmg' })).toBe('Foreman-2.0.1-mac-x64.dmg')
    expect(name({ platform: 'linux', arch: 'x64', kind: 'appimage' })).toBe('Foreman-2.0.1-linux-x86_64.AppImage')
    expect(name({ platform: 'linux', arch: 'x64', kind: 'deb' })).toBe('Foreman-2.0.1-linux-amd64.deb')
    expect(name({ platform: 'linux', arch: 'arm64', kind: 'deb' })).toBeUndefined()
    expect(name({ platform: 'linux', arch: 'x64', kind: null })).toBeUndefined()
  })

  it('matches assets by platform, architecture and extension, not by the file name prefix', () => {
    const rel = {
      tag_name: '3.0.0',
      assets: [
        'Foreman-3.0.0-windows-x64.msi',
        'Foreman-3.0.0-mac-arm64.dmg',
        'Foreman-3.0.0-linux-x86_64.AppImage',
        'Foreman-3.0.0-linux-amd64.deb',
      ].map(asset),
    }
    const name = (o: Parameters<typeof pickAsset>[1], assets = rel.assets) => pickAsset(assets, o)?.name
    expect(name({ platform: 'win32', arch: 'x64', kind: 'msi' })).toBe('Foreman-3.0.0-windows-x64.msi')
    expect(name({ platform: 'darwin', arch: 'arm64', kind: 'dmg' })).toBe('Foreman-3.0.0-mac-arm64.dmg')
    expect(name({ platform: 'linux', arch: 'x64', kind: 'deb' })).toBe('Foreman-3.0.0-linux-amd64.deb')
    // A release carrying both prefixes (compatibility copies) still resolves to one installer.
    const both = [...['Foreman-3.0.0-windows-x64.msi'].map(asset), ...rel.assets]
    expect(name({ platform: 'win32', arch: 'x64', kind: 'msi' }, both)).toBe('Foreman-3.0.0-windows-x64.msi')
    expect(newer(rel.tag_name, '2.0.0')).toBe(true)
  })

  it('checks sizes and sha256 digests of downloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foreman-upd-'))
    try {
      const file = join(dir, 'a.msi')
      writeFileSync(file, 'installer bytes')
      expect(downloaded(file, 15)).toBe(true)
      expect(downloaded(file, 16)).toBe(false)
      expect(downloaded(join(dir, 'missing'), 1)).toBe(false)
      const good = 'sha256:' + createHash('sha256').update('installer bytes').digest('hex')
      await expect(verifyDigest(file, good)).resolves.toBe(true)
      await expect(verifyDigest(file, null)).resolves.toBe(false)
      await expect(verifyDigest(file, 'sha256:' + '0'.repeat(64))).rejects.toThrow('digest mismatch')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes install workers that wait for the app and quote paths', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
    const mac = macInstallScript({ pid: 42, dmg: '/tmp/O.dmg', bundle: '/Applications/Operant 2.app', log: '/tmp/l', relaunch: true })
    expect(mac).toContain('while kill -0 42')
    expect(mac).toContain(`ditto "$mnt/Foreman.app" "$bundle.new"`)
    expect(mac).toContain(`bundle='/Applications/Operant 2.app'`)
    expect(mac).toMatch(/open "\$bundle"\nsay done$/)
    expect(macInstallScript({ pid: 1, dmg: 'd', bundle: 'b', log: 'l', relaunch: false })).not.toContain('open "$bundle"')

    const ai = appImageInstallScript({ pid: 7, appImage: '/tmp/n', target: '/home/u/O.AppImage', log: '/tmp/l', relaunch: false })
    expect(ai).toContain('mv -f "$target.new" "$target"')
    expect(ai).not.toContain('nohup')
    expect(debInstallScript({ pid: 7, deb: '/tmp/o.deb', exe: '/opt/Operant 2/foreman', log: 'l', relaunch: true })).toContain(
      'pkexec dpkg -i "$deb"',
    )

    const msi = msiWorkerScript({
      pid: 9,
      exe: "C:\\Program Files\\Operant 2\\Operant 2.exe",
      installDir: 'C:\\Program Files\\Operant 2',
      msi: "C:\\Temp\\O'2.msi",
      log: 'C:\\Temp\\l.log',
      relaunch: true,
      version: '3.4.0',
      lock: 'C:\\Temp\\Foreman-update.lock',
      result: 'C:\\Temp\\r.txt',
    })
    expect(msi).toContain('Wait-Process -Id 9')
    expect(msi).toContain(`/i "C:\\Temp\\O''2.msi" /passive`)
    expect(msi).toContain(`Test-Path -LiteralPath 'C:\\Program Files\\Operant 2\\Operant 2.exe'`)
    expect(msi).toContain('REINSTALL=ALL')
    expect(msi).toContain('-Verb RunAs')
    expect(msi).not.toContain('/qn')
    expect(msi).toContain('1223')
    expect(msi).toContain('if ($code -ne 1618) { break }')
    expect(msi.match(/1618/g)).toHaveLength(1)
    // One UAC prompt: only the elevated script starts with RunAs, and msiexec (install and repair) runs inside it.
    expect(msi.match(/-Verb RunAs/g)).toHaveLength(1)
    expect(msi.indexOf('REINSTALL=ALL')).toBeLessThan(msi.indexOf("\n'@"))
    expect(msi.indexOf('-Verb RunAs')).toBeGreaterThan(msi.indexOf("\n'@"))
    expect(msi).toContain(`Set-Content -LiteralPath 'C:\\Temp\\r.txt' -Value "3.4.0 $code"`)
    // The lock is written first and removed before the relaunch, or the relaunched copy would close again.
    expect(msi.startsWith(`$lock = 'C:\\Temp\\Foreman-update.lock'`)).toBe(true)
    const relaunch = msi.indexOf(`Start-Process -FilePath 'C:\\Program Files\\Operant 2\\Operant 2.exe'`)
    expect(relaunch).toBeGreaterThan(msi.indexOf('Remove-Item -LiteralPath $lock'))
    expect(msi).not.toContain('Remove-Item -LiteralPath $old')

    const moved = msiWorkerScript({
      pid: 9,
      exe: 'C:\\Program Files\\Foreman\\Foreman.exe',
      installDir: 'C:\\Program Files\\Foreman',
      msi: 'C:\\Temp\\o.msi',
      log: 'C:\\Temp\\l.log',
      relaunch: false,
      version: '3.4.0',
      lock: 'C:\\Temp\\k.lock',
      result: 'C:\\Temp\\r.txt',
      oldDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\Foreman',
    })
    expect(moved).toContain(`$old = 'C:\\Users\\me\\AppData\\Local\\Programs\\Foreman'`)
    expect(moved).toContain(`$oldExe = Join-Path $old 'Foreman.exe'`)
    expect(moved).toContain(`-ine 'C:\\Program Files\\Foreman'`)
    expect(moved).toContain('Test-Path -LiteralPath $oldExe')
    expect(moved).toContain('Remove-Item -LiteralPath $old -Recurse -Force')
    // Only the program folder is removed, never anything under the app data folders.
    expect(moved.match(/Remove-Item -LiteralPath \$old /g)).toHaveLength(1)
    expect(moved).not.toMatch(/Roaming|\$env:/i)
    expect(moved.indexOf('Remove-Item -LiteralPath $old ')).toBeGreaterThan(moved.indexOf('-Verb RunAs'))
    expect(moved).not.toContain('Start-Process -FilePath')
  })

  it('tells a running install from a stale lock', () => {
    const now = 10_000_000
    const alive = (pid: number) => pid === 42
    expect(updateRunning(null, alive, now)).toBe(false)
    expect(updateRunning({ text: '42\r\n', mtimeMs: now - 60_000 }, alive, now)).toBe(true)
    expect(updateRunning({ text: '43', mtimeMs: now - 60_000 }, alive, now)).toBe(false)
    expect(updateRunning({ text: '42', mtimeMs: now - 46 * 60_000 }, alive, now)).toBe(false)
    expect(updateRunning({ text: 'junk', mtimeMs: now }, alive, now)).toBe(false)
  })

  it('says why the last update did not install', () => {
    expect(updateFailureMessage('3.4.0 0', '3.3.0', 'l.log')).toBeNull()
    expect(updateFailureMessage('3.4.0 3010', '3.3.0', 'l.log')).toBeNull()
    expect(updateFailureMessage('3.4.0 1603', '3.4.0', 'l.log')).toBeNull()
    expect(updateFailureMessage('', '3.3.0', 'l.log')).toBeNull()
    expect(updateFailureMessage('3.4.0 1603\r\n', '3.3.0', 'l.log')).toBe('The update to 3.4.0 did not install (Windows Installer code 1603). Details: l.log')
    expect(updateFailureMessage('3.4.0 1223', '3.3.0', 'l.log')).toContain('cancelled')
    expect(updateFailureMessage('3.4.0 -2', '3.3.0', 'l.log')).toContain('still running')
  })
})
