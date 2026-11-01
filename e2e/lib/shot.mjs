// Shared e2e screenshot helper. Each shot is saved to docs/specs/screenshots as <name>-<YYYYMMDD-HHmmss>.png.
// When the run was started from a Foreman tile (FOREMAN_TOKEN set), the shot is also sent to that tile's chat.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const shotsDir = fileURLToPath(new URL('../../docs/specs/screenshots/', import.meta.url))

const pad = (n) => String(n).padStart(2, '0')
const stamp = (d = new Date()) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
const slugify = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'shot'

function freePath(base) {
  let path = join(shotsDir, `${base}.png`)
  for (let n = 2; existsSync(path); n++) path = join(shotsDir, `${base}-${n}.png`)
  return path
}

// Best effort: a failed or missing foreman command never fails the test.
function sendToTile(file, slug) {
  return new Promise((done) => {
    const child = spawn('foreman', ['shot', file, '--kind', `e2e-${slug}`], { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => child.kill(), 15_000)
    const finish = () => {
      clearTimeout(timer)
      done()
    }
    child.on('error', finish)
    child.on('close', finish)
  })
}

export async function shot(page, name) {
  const slug = slugify(name)
  mkdirSync(shotsDir, { recursive: true })
  const ignore = join(shotsDir, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n')

  await page.waitForTimeout(500)
  const tmp = mkdtempSync(join(tmpdir(), 'foreman-shot-'))
  try {
    await page.screenshot({ path: join(tmp, 'shot.png') })
    const file = freePath(`${slug}-${stamp()}`)
    copyFileSync(join(tmp, 'shot.png'), file)
    if (process.env.FOREMAN_TOKEN) await sendToTile(file, slug)
    return file
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
