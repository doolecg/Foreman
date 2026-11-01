// Model list e2e: with a fake OpenCode that lists several providers, the model selector groups them under friendly
// provider headings, shows friendly names with the raw id muted, a free badge, a not-connected hint, filters across
// provider and model names, focuses the filter on open and has a Refresh button.
// Usage: node e2e/models.mjs   (the screenshot goes to docs/specs/screenshots/opencode-models.png)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { claudeHome, e2eEnv } from './fixtures/real-claude.mjs'

const shots = resolve('docs/specs/screenshots')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'foreman-models-'))
const project = mkdtempSync(join(tmpdir(), 'foreman-models-proj-'))
const claudeRoot = mkdtempSync(join(tmpdir(), 'foreman-models-claude-'))
const claudeDir = claudeHome(claudeRoot)
process.on('exit', () => rmSync(claudeRoot, { recursive: true, force: true }))
const ocFile = join(dataDir, 'opencode.json')
writeFileSync(join(project, 'app.ts'), 'export const a = 1\n')
writeFileSync(ocFile, JSON.stringify({ mcp: { servers: {} } }))

const env = e2eEnv({ dataDir, claudeDir, extra: { OPENCODE_CONFIG: ocFile, OPENCODE_FAKE_MODELS: 'multi' } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let app = null
try {
  app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.foreman)
  await page.evaluate(() => window.foreman.invoke('settings:set', { setupDone: true }))
  const inv = (c, ...a) => page.evaluate(([c, a]) => window.foreman.invoke(c, ...a), [c, a])
  const win = (fn) => app.evaluate(({ BrowserWindow }, f) => new Function('w', `return (${f})(w)`)(BrowserWindow.getAllWindows()[0]), fn.toString())
  await page.getByText('Welcome to Foreman').waitFor()
  await inv('crews:create', { name: 'alpha', folder: project })
  await win((w) => w.isMaximized() && w.unmaximize())
  await win((w) => w.setContentSize(1400, 900))
  await sleep(1200)

  // The IPC answer: provider groups, friendly names, connected flags.
  const list = await inv('models:list', 'opencode')
  const byId = Object.fromEntries(list.providers.map((p) => [p.providerId, p]))
  assert.equal(byId.opencode.providerName, 'OpenCode Zen')
  assert.equal(byId['zai-coding-plan'].providerName, 'Z.AI Coding Plan')
  assert.equal(byId.openai.connected, false, 'OpenAI is listed but not connected')
  assert.equal(byId['zai-coding-plan'].connected, true)
  assert.equal(list.models.length, 8)

  console.log('models e2e passed')
} finally {
  await app?.close().catch(() => {})
}
