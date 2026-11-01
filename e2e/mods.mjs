// Mods e2e: a real Claude tile (Haiku). One short turn, sent through the Chat view, runs a sub-agent: the hook
// events take its row in the Agents panel to Done. Then the Terminal view resumes the session: the status line the Mods
// wrote into --settings reports the model into the info bar, and the context card never invents numbers. (The Waiting state
// comes from Claude's idle Notification, which fires only after a minute idle in the Terminal view; not checked here.)
// Runs in the background with throwaway data and CLAUDE_CONFIG_DIR. Usage: node e2e/mods.mjs [outDir]  (default docs/specs/screenshots)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { shot } from './lib/shot.mjs'
import { claudeHome, e2eEnv } from './fixtures/real-claude.mjs'
import { waitProjectOpen } from './fixtures/ui.mjs'

const outDir = resolve(process.argv[2] ?? 'docs/specs/screenshots')
mkdirSync(outDir, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'foreman-mods-'))
const project = mkdtempSync(join(tmpdir(), 'foreman-mods-proj-'))
const claudeRoot = mkdtempSync(join(tmpdir(), 'foreman-mods-claude-'))
const claudeDir = claudeHome(claudeRoot, { trust: [project] })
process.on('exit', () => rmSync(claudeRoot, { recursive: true, force: true }))
writeFileSync(join(project, 'app.ts'), 'export const a = 1\n')

const env = e2eEnv({ dataDir, claudeDir })

const app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForFunction(() => !!window.foreman)
  await page.evaluate(() => window.foreman.invoke('settings:set', { setupDone: true }))
  const inv = (channel, ...args) => page.evaluate(([c, a]) => window.foreman.invoke(c, ...a), [channel, args])
  const until = async (label, fn, timeout) => {
    for (const end = Date.now() + timeout; Date.now() < end; await page.waitForTimeout(250)) if (await fn().catch(() => false)) return
    throw new Error(`timed out waiting for ${label}`)
  }

  await page.getByText('Welcome to Foreman').waitFor()
  await inv('crews:create', { name: 'mods', folder: project })
  await inv('settings:set', { mainCli: 'claude', mods: { enabled: true, mods: { subagents: true } }, infoBar: true })
  await page.locator('[data-crew-row]').getByText('mods', { exact: true }).click({ position: { x: 4, y: 4 } })
  await waitProjectOpen(page, 'mods')

  // A Claude tile: it opens in the Chat view, with the Agents panel beside it.
  await page.locator('[data-crew-row]').getByText('mods', { exact: true }).click({ button: 'right', position: { x: 4, y: 4 } })
  await page.getByRole('menuitem', { name: 'New Claude terminal here' }).click()
  await page.locator('[data-chat="thread-header"]').getByRole('heading', { name: /^Claude: / }).waitFor({ timeout: 20_000 })
  // The side panels sit behind a rail of buttons now: Agents opens its panel.
  await page.getByRole('navigation', { name: 'Side panels' }).getByRole('button', { name: 'Agents' }).click()
  const panel = page.getByTestId('subagent-panel')
  await panel.waitFor()
  assert.match(await panel.innerText(), /Agents/)
  await shot(page, 'mods-subagent-panel')

  // One short real turn (Haiku), sent through the Chat view: the hooks take the sub-agent's row to Done.
  const crew = (await inv('crews:list')).find((c) => c.name === 'mods')
  const tile = (await inv('scratch:list', crew.id)).find((t) => t.agent === 'claude')
  const snap = () => inv('chat:snapshot', tile.id)
  await until('Claude to be ready', async () => (await snap()).process === 'ready', 90_000)
  await inv('chat:send', tile.id, { text: 'Use the Task tool exactly once, in the foreground: a general-purpose sub-agent whose only job is to reply with the word ok. Then reply DONE.' })
  await until('the turn to start', async () => (await snap()).turn.phase !== 'idle', 30_000)
  await panel.getByRole('img', { name: /^(Running|Done)$/ }).first().waitFor({ timeout: 120_000 })
  await shot(page, 'mods-subagent-running')
  await until('the turn to finish', async () => (await snap()).turn.phase === 'idle', 240_000)
  await panel.getByRole('img', { name: 'Done' }).first().waitFor({ timeout: 60_000 }) // a summary check and the agent's own row both say Done
  assert.equal(await panel.getByRole('img', { name: 'Running' }).count(), 0, 'no agent runs any more')
  await shot(page, 'mods-subagent-completed')

  // The Terminal view (the same session resumed): the status line reports the model and the context into the info bar.
  // The view switch lives in the thread's options menu now.
  await page.getByRole('button', { name: 'Thread options' }).click()
  await page.getByRole('menuitem', { name: 'Show the terminal view' }).click()
  // The info bar belongs to the tile frame, so it shows in the Tiles view (the Thread view has no frame).
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Tiles', exact: true }).click()
  const info = page.getByLabel('Tile info')
  await info.waitFor()
  await info.getByText(/Haiku/).waitFor({ timeout: 60_000 })

  // The context card opens from the info bar's context bar: real numbers only.
  await info.getByRole('button', { name: 'Context details' }).click()
  const card = page.getByRole('region', { name: 'Context' }).last()
  await card.waitFor()
  // The resumed session has not made a request yet, so the card shows real numbers or says none are reported (never invented).
  assert.match(await card.innerText(), /No context reported yet|Category breakdown/)
  await shot(page, 'mods-context-popover')
  await info.getByRole('button', { name: 'Context details' }).click() // closes the popover

  console.log('mods e2e ok')
} catch (e) {
  await (await app.firstWindow()).screenshot({ path: join(outDir, 'mods-failure.png') }).catch(() => {})
  throw e
} finally {
  await app.close()
}
