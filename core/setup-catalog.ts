import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The setup catalog is the same catalog.json that Dayle's /project-setup skill reads, so both give the same answer.
// It lives in the user's .claude/library by default; the caller passes another folder if the user points Foreman elsewhere.

export type CatalogKind = 'agents' | 'mcp' | 'skills' | 'plugins'

export interface CatalogEntry {
  needed_when: string
  how: string
  keywords?: string[]
  // mcp: the block copied verbatim into .mcp.json
  config?: Record<string, unknown>
  // skill: folder copied into the project's .claude/skills/
  path?: string
  // skill: an agent that already carries it, so it is not copied
  carried_by?: string
  // plugin: id written to enabledPlugins
  id?: string
}

export interface Catalog {
  agents: Record<string, CatalogEntry>
  mcp: Record<string, CatalogEntry>
  skills: Record<string, CatalogEntry>
  plugins: Record<string, CatalogEntry>
  presets: Record<string, string[]>
}

export interface SetupPick {
  kind: CatalogKind
  name: string
  // Why it was picked: 'preset <name>' or the keywords that matched.
  why: string
}

export interface SetupPlan {
  preset: string
  picks: SetupPick[]
}

export function loadCatalog(libraryDir: string): Catalog {
  const raw = JSON.parse(readFileSync(join(libraryDir, 'catalog.json'), 'utf8')) as Partial<Catalog>
  return {
    agents: raw.agents ?? {},
    mcp: raw.mcp ?? {},
    skills: raw.skills ?? {},
    plugins: raw.plugins ?? {},
    presets: raw.presets ?? {},
  }
}

// Words in the project prompt that point at a preset. The first preset with a hit wins; no hit means 'other'.
const PRESET_HINTS: Array<[string, string[]]> = [
  ['game-design', ['game design', 'design doc', 'gdd', 'level design']],
  ['godot', ['godot', 'game', 'gdscript']],
  ['video', ['video', 'shorts', 'youtube', 'reel', 'edit footage']],
  ['electron', ['electron', 'desktop app']],
  ['web-apps', ['web app', 'webapp', 'saas', 'dashboard', 'admin panel']],
  ['seo', ['seo', 'marketing site', 'keywords', 'search ranking']],
  ['apps', ['mobile app', 'ios', 'android', 'app']],
  ['backend', ['backend', 'back end', 'api', 'server', 'database']],
  ['writing', ['docs', 'documentation', 'blog', 'article', 'book', 'writing']],
  ['research', ['research', 'notes', 'study']],
  ['software', ['software', 'cli', 'library', 'tool']],
  ['web', ['website', 'landing', 'next.js', 'nextjs', 'frontend', 'front end', 'site']],
]

function hasWord(text: string, word: string): boolean {
  const i = text.indexOf(word)
  if (i < 0) return false
  // Whole-word match, so "site" does not fire inside "opposite".
  const before = text[i - 1]
  const after = text[i + word.length]
  const edge = (c: string | undefined) => c === undefined || !/[a-z0-9]/.test(c)
  return (edge(before) && edge(after)) || hasWord(text.slice(i + 1), word)
}

export function pickPreset(catalog: Catalog, prompt: string): string {
  const text = prompt.toLowerCase()
  for (const [preset, words] of PRESET_HINTS) {
    if (catalog.presets[preset] && words.some((w) => hasWord(text, w))) return preset
  }
  return catalog.presets.other ? 'other' : Object.keys(catalog.presets)[0] ?? 'other'
}

// Preset members plus any catalog item whose keywords appear in the prompt. Free: no model call.
// A preset the person chose wins over the one guessed from the prompt.
export function planSetup(catalog: Catalog, prompt: string, chosen?: string): SetupPlan {
  const text = prompt.toLowerCase()
  const preset = chosen && catalog.presets[chosen] ? chosen : pickPreset(catalog, prompt)
  const picks = new Map<string, SetupPick>()
  const kinds: CatalogKind[] = ['agents', 'mcp', 'skills', 'plugins']
  const add = (kind: CatalogKind, name: string, why: string) => {
    const key = `${kind}:${name}`
    const old = picks.get(key)
    picks.set(key, { kind, name, why: old ? `${old.why}; ${why}` : why })
  }
  for (const member of catalog.presets[preset] ?? []) {
    const kind = kinds.find((k) => catalog[k][member])
    if (kind) add(kind, member, `preset ${preset}`)
  }
  for (const kind of kinds) {
    for (const [name, entry] of Object.entries(catalog[kind])) {
      const hits = (entry.keywords ?? []).filter((k) => hasWord(text, k.toLowerCase()))
      if (hits.length) add(kind, name, `mentions ${hits.join(', ')}`)
    }
  }
  return { preset, picks: [...picks.values()] }
}
