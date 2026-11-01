// Terminal view tiles e2e: a project with no terminals shows an empty note, new shells open as tiles side by side, and
// the layout / fullscreen / close keys work. Runs in the background with throwaway data. Needs the Terminal view mounted
// by the app shell (TerminalView fed by useTerminals, drawer given hideCrewId).
// Usage: node e2e/terminal.mjs [outDir]  (default docs/specs/screenshots)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { shot } from './lib/shot.mjs'
import { claudeHome, e2eEnv } from './fixtures/real-claude.mjs'
import { waitProjectOpen } from './fixtures/ui.mjs'

const outDir = resolve(process.argv[2] ?? 'docs/specs/screenshots')
mkdirSync(outDir, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'foreman-term-'))
const project = mkdtempSync(join(tmpdir(), 'foreman-term-proj-'))
const claudeRoot = mkdtempSync(join(tmpdir(), 'foreman-term-claude-'))
const claudeDir = claudeHome(claudeRoot)
process.on('exit', () => rmSync(claudeRoot, { recursive: true, force: true }))
writeFileSync(join(project, 'app.ts'), 'export const a = 1\n')

const env = e2eEnv({ dataDir, claudeDir })

const app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForFunction(() => !!window.foreman)
  const inv = (channel, ...args) => page.evaluate(([c, a]) => window.foreman.invoke(c, ...a), [channel, args])
  await inv('settings:set', { setupDone: true })
  const poll = async (label, fn, timeout = 15_000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await page.waitForTimeout(200)) if (await fn()) return
    throw new Error(`timed out waiting for ${label}`)
  }
  const tiles = () => page.locator('[data-tile]')
  const rectOf = (loc) => loc.evaluate((e) => ({ x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }))

  await page.getByText('Welcome to Foreman').waitFor()
  await inv('crews:create', { name: 'tiles', folder: project })
  // Closing a tile asks first by default (projects.mjs covers that dialog); here the ask is off so the close button and key act at once.
  await inv('settings:set', { tiles: { layout: 'dwindle', gaps: 6 }, confirm: { closeTile: false } })
  await page.locator('[data-crew-row]').getByText('tiles', { exact: true }).click({ position: { x: 4, y: 4 } })
  await waitProjectOpen(page, 'tiles')
  // Tiles are their own view now (Thread shows one thread full size): switch the top bar to Tiles.
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Tiles', exact: true }).click()

  // No terminals yet: an empty note, no tile surface.
  await page.getByText('No threads open').waitFor()
  assert.equal(await tiles().count(), 0)
  await shot(page, 'terminal-tiles-empty')

  // The project row's agent button opens the main CLI (Claude) as a tile, and that tile takes the focus.
  await inv('settings:set', { mainCli: 'claude' })
  const row = page.locator('[data-crew-row]')
  await row.getByText('tiles', { exact: true }).hover()
  await row.getByRole('button', { name: 'New Claude terminal in tiles' }).click()
  await poll('Claude tile', async () => (await tiles().count()) === 1)
  const claude = page.getByRole('region', { name: /^Claude: tiles/ })
  assert.equal(await claude.count(), 1, 'the agent tile title starts with Claude')
  assert.equal(await claude.getAttribute('data-focused'), 'true', 'the new agent tile is focused')
  await page.getByRole('button', { name: /^Close Claude: / }).click()
  await poll('Claude tile closed', async () => (await tiles().count()) === 0)

  // Shells now open in the bottom drawer, not as tiles: only the agent threads are tiles. Two Claude tiles (the real CLI, never
  // prompted) sit side by side.
  await row.getByText('tiles', { exact: true }).hover()
  await row.getByRole('button', { name: 'New Claude terminal in tiles' }).click()
  await poll('first agent tile', async () => (await tiles().count()) === 1)
  await row.getByText('tiles', { exact: true }).hover()
  await row.getByRole('button', { name: 'New Claude terminal in tiles' }).click()
  await poll('second agent tile', async () => (await tiles().count()) === 2)
  assert.equal(await page.getByTestId('terminal-drawer').count(), 0, 'no shell was started, so the drawer stays closed')
  const surface = page.getByTestId('tile-surface')
  await surface.waitFor()
  const shells = page.getByRole('region', { name: /^Claude: / })
  const a = tiles().nth(0)
  const b = tiles().nth(1)
  const ra = await rectOf(a)
  const rb = await rectOf(b)
  assert.ok(ra.x !== rb.x || ra.y !== rb.y, 'the agent tiles have their own rects')
  await shot(page, 'terminal-tiles-agents')

  // Layout key: the master layout puts the first tile in a left pane of fixed share.
  await page.keyboard.press('Alt+Shift+L')
  await poll('master layout', async () => (await surface.getAttribute('data-layout')) === 'master')
  await page.waitForTimeout(400)
  const after = await rectOf(a)
  assert.ok(after.h !== ra.h || after.w !== ra.w, 'the layout key changes the tile rects')
  await shot(page, 'terminal-tiles-master-layout')

  // Fullscreen key: the focused tile fills the surface, the others hide; pressing again restores.
  await a.click({ position: { x: 20, y: 12 } })
  await page.keyboard.press('Alt+Shift+F')
  await poll('fullscreen', async () => (await a.getAttribute('data-fullscreen')) === 'true')
  await page.waitForTimeout(300)
  const box = await surface.evaluate((e) => ({ w: e.clientWidth, h: e.clientHeight }))
  const full = await rectOf(a)
  assert.ok(Math.abs(full.w - box.w) <= 1 && Math.abs(full.h - box.h) <= 1, 'fullscreen fills the surface')
  await page.keyboard.press('Alt+Shift+F')
  await poll('fullscreen off', async () => (await a.getAttribute('data-fullscreen')) === 'false')

  // Close tile: the button and the key each remove a tile.
  await page.getByRole('button', { name: /^Close Claude: / }).first().click()
  await poll('one tile closed', async () => (await tiles().count()) === 1)
  await tiles().first().click({ position: { x: 20, y: 12 } })
  await page.keyboard.press('Alt+Shift+W')
  await poll('last tile closed', async () => (await tiles().count()) === 0)
  assert.equal(await shells.count(), 0)
  await shot(page, 'terminal-tiles-closed')
  console.log('terminal e2e ok')
} finally {
  await app.close()
}
