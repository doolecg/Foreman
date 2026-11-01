import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Catalog, SetupPlan } from './setup-catalog'

// Writes a setup plan into one project folder. Project-level files only: it never touches the global config, never
// deletes, and never replaces an entry that is already there.

export interface SetupResult {
  written: string[]
  // Things that were already there or could not be read, each with the reason.
  skipped: string[]
  // True when a plugin was switched on, because plugins may need a restart.
  needsRestart: boolean
}

type Json = Record<string, unknown>

function readJson(file: string): Json | 'bad' | null {
  if (!existsSync(file)) return null
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : 'bad'
  } catch {
    return 'bad'
  }
}

// Adds `entries` under `key` of a JSON file, keeping every existing entry. Returns the names that were added.
function mergeJson(file: string, key: string, entries: Record<string, unknown>, res: SetupResult): string[] {
  if (!Object.keys(entries).length) return []
  const doc = readJson(file)
  if (doc === 'bad') {
    res.skipped.push(`${file}: not valid JSON, left alone`)
    return []
  }
  const next: Json = doc ?? {}
  const section = (next[key] && typeof next[key] === 'object' ? next[key] : {}) as Json
  const added: string[] = []
  for (const [name, value] of Object.entries(entries)) {
    if (name in section) res.skipped.push(`${file}: ${name} already there`)
    else {
      section[name] = value
      added.push(name)
    }
  }
  if (!added.length) return []
  next[key] = section
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
  res.written.push(file)
  return added
}

export function writeSetup(folder: string, catalog: Catalog, plan: SetupPlan, date: string): SetupResult {
  const res: SetupResult = { written: [], skipped: [], needsRestart: false }
  const lines: string[] = []
  const picked = (kind: string, name: string) => plan.picks.some((p) => p.kind === kind && p.name === name)

  const agents = plan.picks.filter((p) => p.kind === 'agents')
  if (agents.length) lines.push(`Agents used on demand: ${agents.map((a) => a.name).join(', ')} (global, nothing to install).`)

  const mcp: Record<string, unknown> = {}
  for (const p of plan.picks.filter((x) => x.kind === 'mcp')) {
    const cfg = catalog.mcp[p.name]?.config
    if (cfg) mcp[p.name] = cfg
  }
  for (const name of mergeJson(join(folder, '.mcp.json'), 'mcpServers', mcp, res))
    lines.push(`MCP ${name}: ${plan.picks.find((p) => p.name === name && p.kind === 'mcp')!.why}. Off: delete its entry in .mcp.json.`)

  for (const p of plan.picks.filter((x) => x.kind === 'skills')) {
    const entry = catalog.skills[p.name]
    if (!entry?.path) continue
    if (entry.carried_by && picked('agents', entry.carried_by)) {
      res.skipped.push(`skill ${p.name}: the ${entry.carried_by} agent already carries it`)
      continue
    }
    const dest = join(folder, '.claude', 'skills', p.name)
    if (existsSync(dest)) {
      res.skipped.push(`${dest}: already there`)
      continue
    }
    if (!existsSync(entry.path)) {
      res.skipped.push(`skill ${p.name}: source folder ${entry.path} is missing`)
      continue
    }
    mkdirSync(join(folder, '.claude', 'skills'), { recursive: true })
    cpSync(entry.path, dest, { recursive: true })
    res.written.push(dest)
    lines.push(`Skill ${p.name}: ${p.why}. Off: delete .claude/skills/${p.name}.`)
  }

  const plugins: Record<string, unknown> = {}
  for (const p of plan.picks.filter((x) => x.kind === 'plugins')) {
    const id = catalog.plugins[p.name]?.id
    if (id) plugins[id] = true
  }
  for (const id of mergeJson(join(folder, '.claude', 'settings.json'), 'enabledPlugins', plugins, res)) {
    res.needsRestart = true
    lines.push(`Plugin ${id}. Off: remove it from enabledPlugins in .claude/settings.json.`)
  }

  if (lines.length) {
    const file = join(folder, 'CLAUDE.md')
    const old = existsSync(file) ? readFileSync(file, 'utf8') : `# ${basename(folder)}\n`
    const head = /^## Setup\b/m.test(old) ? `### Added ${date}` : `## Setup\nWritten ${date} by Foreman. Preset: ${plan.preset}.`
    writeFileSync(file, `${old.trimEnd()}\n\n${head}\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
    res.written.push(file)
  }
  return res
}
