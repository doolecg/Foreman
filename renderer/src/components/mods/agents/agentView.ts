import { modelName } from '@shared/models'
import type { ChatItem, McpServerInfo, SubagentItem } from '@shared/claude-chat'
import { costUsd } from '../../../../../core/pricing'
import { kTokens, type AgentRowModel } from '@/components/chat/chatHelpers'

// Pure helpers of the Agents panel (names, critters, effort, progress, metrics, summaries). No React so they can be tested.

export const CUTE_NAMES = [
  'Pip', 'Mochi', 'Biscuit', 'Sprout', 'Nugget', 'Pebble', 'Waffle', 'Bean', 'Noodle', 'Toffee',
  'Fizz', 'Button', 'Clover', 'Dumpling', 'Pickle', 'Muffin', 'Bubbles', 'Sprocket', 'Tater', 'Jellybean',
  'Pudding', 'Cricket', 'Peanut', 'Doodle', 'Truffle', 'Pretzel', 'Sesame', 'Marble', 'Twig', 'Cocoa',
  'Poppy', 'Bumble', 'Gumdrop', 'Tofu', 'Zippy', 'Ember', 'Maple', 'Olive', 'Pixel', 'Ziggy',
  'Honey', 'Beanie', 'Pogo', 'Crumpet', 'Sundae', 'Wobble', 'Fudge', 'Snickers', 'Dot', 'Kiwi',
  'Lentil', 'Mango', 'Nibbles', 'Pancake', 'Quill', 'Rascal', 'Sprinkle', 'Turnip', 'Wiggles', 'Yo-yo',
]

// Friendly characters from TV and film; `from` is the reference shown as a tooltip.
export const SCREEN_NAMES: Array<{ name: string; from: string }> = [
  { name: 'R2-D2', from: 'R2-D2: the plucky astromech droid, Star Wars' },
  { name: 'C-3PO', from: 'C-3PO: the polite protocol droid, Star Wars' },
  { name: 'BB-8', from: 'BB-8: the rolling orange droid, Star Wars' },
  { name: 'Chewie', from: 'Chewie: the loyal Wookiee co-pilot, Star Wars' },
  { name: 'Yoda', from: 'Yoda: the tiny wise Jedi master, Star Wars' },
  { name: 'Grogu', from: 'Grogu: the curious little foundling, The Mandalorian' },
  { name: 'Marvin', from: 'Marvin: the gloomy robot with a big brain, The Hitchhiker\'s Guide to the Galaxy' },
  { name: 'HAL', from: 'HAL: the calm ship computer, 2001: A Space Odyssey' },
  { name: 'Data', from: 'Data: the curious android officer, Star Trek: The Next Generation' },
  { name: 'Spock', from: 'Spock: the logical science officer, Star Trek' },
  { name: 'Scotty', from: 'Scotty: the miracle-working engineer, Star Trek' },
  { name: 'WALL-E', from: 'WALL-E: the tidy little trash-compacting robot, WALL-E' },
  { name: 'EVE', from: 'EVE: the sleek plant-hunting probe, WALL-E' },
  { name: 'Baymax', from: 'Baymax: the gentle inflatable healthcare robot, Big Hero 6' },
  { name: 'Johnny 5', from: 'Johnny 5: the curious robot who is alive, Short Circuit' },
  { name: 'Bender', from: 'Bender: the bending robot with a big appetite, Futurama' },
  { name: 'Fry', from: 'Fry: the delivery boy from the past, Futurama' },
  { name: 'K-9', from: 'K-9: the faithful robot dog, Doctor Who' },
  { name: 'TARS', from: 'TARS: the dry-witted blocky robot, Interstellar' },
  { name: 'Gort', from: 'Gort: the silent, mighty robot, The Day the Earth Stood Still' },
  { name: 'Robby', from: 'Robby: the helpful robot butler, Forbidden Planet' },
  { name: 'Rosie', from: 'Rosie: the busy robot maid, The Jetsons' },
  { name: 'Astro', from: 'Astro: the Jetsons\' talking dog, The Jetsons' },
  { name: 'Optimus', from: 'Optimus: the noble robot leader, Transformers' },
  { name: 'Bumblebee', from: 'Bumblebee: the small, brave yellow robot, Transformers' },
  { name: 'Iron Giant', from: 'Iron Giant: the gentle giant robot, The Iron Giant' },
  { name: 'Sonny', from: 'Sonny: the thoughtful robot, I, Robot' },
  { name: 'Dot Matrix', from: 'Dot Matrix: the sassy robot sidekick, Spaceballs' },
  { name: 'Twiki', from: 'Twiki: the beeping robot buddy, Buck Rogers in the 25th Century' },
  { name: 'Gonzo', from: 'Gonzo: the daring blue stuntman, The Muppet Show' },
  { name: 'Kermit', from: 'Kermit: the calm green frog host, The Muppet Show' },
  { name: 'Elmo', from: 'Elmo: the cheerful red monster, Sesame Street' },
  { name: 'Snoopy', from: 'Snoopy: the dreaming beagle, Peanuts' },
  { name: 'Woodstock', from: 'Woodstock: the tiny yellow bird, Peanuts' },
  { name: 'Scooby', from: 'Scooby: the scared but loyal Great Dane, Scooby-Doo' },
  { name: 'Shaggy', from: 'Shaggy: the always-hungry mystery solver, Scooby-Doo' },
  { name: 'Garfield', from: 'Garfield: the lasagna-loving orange cat, Garfield' },
  { name: 'Pikachu', from: 'Pikachu: the electric yellow mouse, Pokemon' },
  { name: 'Totoro', from: 'Totoro: the big gentle forest spirit, My Neighbor Totoro' },
  { name: 'Ponyo', from: 'Ponyo: the little fish girl, Ponyo' },
  { name: 'Jiji', from: 'Jiji: the witch\'s sarcastic black cat, Kiki\'s Delivery Service' },
  { name: 'Mei', from: 'Mei: the adventurous little sister, My Neighbor Totoro' },
  { name: 'Nemo', from: 'Nemo: the small clownfish with a lucky fin, Finding Nemo' },
  { name: 'Dory', from: 'Dory: the forgetful, cheerful blue tang, Finding Nemo' },
  { name: 'Woody', from: 'Woody: the loyal cowboy doll, Toy Story' },
  { name: 'Buzz', from: 'Buzz: the space ranger toy, Toy Story' },
  { name: 'Slinky', from: 'Slinky: the stretchy toy dog, Toy Story' },
  { name: 'Remy', from: 'Remy: the rat who loves cooking, Ratatouille' },
  { name: 'Sulley', from: 'Sulley: the big, kind blue monster, Monsters, Inc.' },
  { name: 'Mike Wazowski', from: 'Mike Wazowski: the one-eyed green sidekick, Monsters, Inc.' },
  { name: 'Boo', from: 'Boo: the giggling little girl, Monsters, Inc.' },
  { name: 'Olaf', from: 'Olaf: the snowman who loves warm hugs, Frozen' },
  { name: 'Simba', from: 'Simba: the young lion cub, The Lion King' },
  { name: 'Timon', from: 'Timon: the wisecracking meerkat, The Lion King' },
  { name: 'Pumbaa', from: 'Pumbaa: the cheerful warthog, The Lion King' },
  { name: 'Baloo', from: 'Baloo: the laid-back dancing bear, The Jungle Book' },
  { name: 'Dumbo', from: 'Dumbo: the flying big-eared elephant, Dumbo' },
  { name: 'Thumper', from: 'Thumper: the chatty little rabbit, Bambi' },
  { name: 'Genie', from: 'Genie: the wish-granting blue spirit, Aladdin' },
  { name: 'Abu', from: 'Abu: the mischievous pet monkey, Aladdin' },
  { name: 'Wallace', from: 'Wallace: the tinkering inventor, Wallace and Gromit' },
  { name: 'Gromit', from: 'Gromit: the clever, silent beagle, Wallace and Gromit' },
  { name: 'Shaun', from: 'Shaun: the mischievous little sheep, Shaun the Sheep' },
  { name: 'Paddington', from: 'Paddington: the polite bear who loves marmalade, Paddington' },
  { name: 'Po', from: 'Po: the kung fu panda, Kung Fu Panda' },
  { name: 'Shrek', from: 'Shrek: the grumpy, kind-hearted ogre, Shrek' },
  { name: 'Stitch', from: 'Stitch: the mischievous blue alien, Lilo and Stitch' },
  { name: 'Hobbes', from: 'Hobbes: the tiger who loves pouncing, Calvin and Hobbes' },
  { name: 'Luigi', from: 'Luigi: the shy, jumpy plumber, Super Mario' },
  { name: 'Yoshi', from: 'Yoshi: the friendly egg-throwing dinosaur, Super Mario' },
  { name: 'Finn', from: 'Finn: the brave young hero, Adventure Time' },
  { name: 'Jake', from: 'Jake: the stretchy magical dog, Adventure Time' },
  { name: 'BMO', from: 'BMO: the cheerful living game console, Adventure Time' },
  { name: 'Bluey', from: 'Bluey: the playful blue heeler pup, Bluey' },
  { name: 'Bingo', from: 'Bingo: the little red heeler sister, Bluey' },
  { name: 'Peppa', from: 'Peppa: the cheerful little pig, Peppa Pig' },
  { name: 'Gizmo', from: 'Gizmo: the cuddly, curious mogwai, Gremlins' },
  { name: 'E.T.', from: 'E.T.: the gentle alien who wants to go home, E.T. the Extra-Terrestrial' },
]

// FNV-1a: a stable hash of the agent id, so a name and a look never change.
export function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// About one agent in two gets a screen name (bit 7 of the hash), the rest a cute one; both are stable per id.
export function agentName(id: string): { name: string; ref: string | null } {
  const h = hashId(id)
  if ((h >>> 7) % 2 === 0) {
    const s = SCREEN_NAMES[h % SCREEN_NAMES.length]!
    return { name: s.name, ref: s.from }
  }
  return { name: CUTE_NAMES[h % CUTE_NAMES.length]!, ref: null }
}

export const cuteName = (id: string): string => agentName(id).name
export const nameRef = (id: string): string | null => agentName(id).ref

export const HATS = ['cap', 'hardhat', 'beanie', 'chef', 'headphones', 'flag', 'bow', 'crown'] as const
export type Hat = (typeof HATS)[number]
export const TINTS = ['coral', 'peach', 'butter'] as const
export type Tint = (typeof TINTS)[number]

export function critterFor(id: string): { hat: Hat; tint: Tint } {
  const h = hashId(id)
  return { hat: HATS[(h >>> 3) % HATS.length]!, tint: TINTS[(h >>> 11) % TINTS.length]! }
}

export type EffortTone = 'success' | 'info' | 'warning' | 'destructive'
export interface EffortInfo {
  word: string
  tone: EffortTone
}

export function effortInfo(effort: string | null | undefined): EffortInfo | null {
  switch ((effort ?? '').toLowerCase()) {
    case 'low':
      return { word: 'light', tone: 'success' }
    case 'medium':
      return { word: 'medium', tone: 'info' }
    case 'high':
      return { word: 'careful', tone: 'warning' }
    case 'xhigh':
    case 'max':
      return { word: 'heavy', tone: 'destructive' }
    default:
      return null
  }
}

// "Opus 5.5" from "claude-opus-5-5".
export function shortModel(model: string | null): string | null {
  if (!model) return null
  return modelName(model).replace(/^Claude /, '').replace(/(\d+) (\d+)$/, '$1.$2')
}

export interface AgentView extends AgentRowModel {
  name: string
  nameRef: string | null
  effort: string | null
  todos: { done: number; total: number } | null
  tokens: number | null
  cost: number | null
  // Claude Code reported a task id, so this one sub-agent can be stopped on its own (Chat view only).
  canStopOne: boolean
}

export interface StopPlan {
  scope: 'one' | 'turn'
  title: string
  // Asked first when stopping the turn would also stop other running sub-agents.
  confirm: { title: string; body: string } | null
}

// What a sub-agent's Stop button does. Only a known task id stops one agent; otherwise the whole turn is interrupted,
// which also stops every other running sub-agent, so the title says so and other running work needs a confirmation.
export function stopPlan(canStopOne: boolean, othersRunning: number): StopPlan {
  if (canStopOne) return { scope: 'one', title: 'Stop this subagent', confirm: null }
  return {
    scope: 'turn',
    title: 'Stop the current turn (stops all subagents)',
    confirm:
      othersRunning > 0
        ? { title: 'Stop the current turn?', body: `This subagent cannot be stopped on its own. Stopping the turn also stops the other ${othersRunning === 1 ? 'running subagent' : `${othersRunning} running subagents`}.` }
        : null,
  }
}

// done/total of the newest TodoWrite the agent made, null when it made none.
export function todoProgress(items: ChatItem[], agentId: string): { done: number; total: number } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind !== 'tool' || it.name !== 'TodoWrite' || it.parent !== agentId) continue
    const todos = (it.input as { todos?: unknown } | null)?.todos
    if (!Array.isArray(todos) || todos.length === 0) return null
    const done = todos.filter((t) => (t as { status?: string } | null)?.status === 'completed').length
    return { done, total: todos.length }
  }
  return null
}

export function agentTokens(a: Pick<SubagentItem, 'usage' | 'outputTokens'>): number | null {
  if (!a.usage) return a.outputTokens > 0 ? a.outputTokens : null
  return a.usage.input + a.usage.cacheRead + a.usage.cacheWrite + a.outputTokens
}

export function agentCost(a: Pick<SubagentItem, 'usage' | 'outputTokens' | 'model'>): number | null {
  if (!a.model || !a.usage) return null
  return costUsd(a.model, { inputTokens: a.usage.input, outputTokens: a.outputTokens, cacheReadTokens: a.usage.cacheRead, cacheWrite5mTokens: a.usage.cacheWrite, cacheWrite1hTokens: 0 })
}

export function viewFor(row: AgentRowModel, item: SubagentItem | null, items: ChatItem[]): AgentView {
  return {
    ...row,
    name: agentName(item?.id ?? row.id).name,
    nameRef: agentName(item?.id ?? row.id).ref,
    effort: item?.effort ?? null,
    todos: item ? todoProgress(items, item.id) : null,
    tokens: item ? agentTokens(item) : null,
    cost: item ? agentCost(item) : null,
    canStopOne: !!item?.taskId,
  }
}

export const money = (n: number): string => `≈$${n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`

export interface Progress {
  label: string | null
  // 0..100, null = no bar.
  pct: number | null
}

// Todos win; otherwise no fraction and the bar is the context fill (hidden when unknown).
export function progressOf(a: Pick<AgentView, 'todos' | 'model' | 'context'>): Progress {
  if (a.todos) return { label: `${a.todos.done}/${a.todos.total}`, pct: (a.todos.done / a.todos.total) * 100 }
  return { label: null, pct: a.context ? a.context.pct : null }
}

// The right-hand line: "ctx 4% · 41k ≈$0.08 0:44", unknown parts left out.
export function metricsOf(a: Pick<AgentView, 'context' | 'tokens' | 'cost'>, elapsed: number | null): string {
  const parts: string[] = []
  if (a.context) parts.push(`ctx ${Math.round(a.context.pct)}%`)
  const tail: string[] = []
  if (a.tokens !== null) tail.push(kTokens(a.tokens))
  if (a.cost !== null) tail.push(money(a.cost))
  if (elapsed !== null) tail.push(cardTime(elapsed))
  const head = parts.join(' · ')
  return [head, tail.join(' ')].filter(Boolean).join(' · ')
}

export interface Summary {
  cost: number | null
  tokens: number | null
  ms: number | null
}

// Sums of the known values only; time = first start to now (any still running) or to the last end.
export function summarize(rows: Array<Pick<AgentView, 'cost' | 'tokens' | 'startedAt' | 'endedAt' | 'dot'>>, now: number): Summary {
  let cost: number | null = null
  let tokens: number | null = null
  let first: number | null = null
  let last: number | null = null
  for (const r of rows) {
    if (r.cost !== null) cost = (cost ?? 0) + r.cost
    if (r.tokens !== null) tokens = (tokens ?? 0) + r.tokens
    if (r.startedAt !== null) {
      first = first === null ? r.startedAt : Math.min(first, r.startedAt)
      const end = r.endedAt ?? (r.dot === 'running' || r.dot === 'waiting' ? now : r.startedAt)
      last = last === null ? end : Math.max(last, end)
    }
  }
  return { cost, tokens, ms: first !== null && last !== null ? Math.max(0, last - first) : null }
}

// The card clock: "0:47".
export function cardTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---- cleared agents, kept per tile

const key = (tileId: number): string => `foreman.agents.cleared.${tileId}`

export function loadCleared(tileId: number): Set<string> {
  try {
    const raw = localStorage.getItem(key(tileId))
    const v: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveCleared(tileId: number, ids: Set<string>): void {
  try {
    localStorage.setItem(key(tileId), JSON.stringify([...ids].slice(-500)))
  } catch {
    /* storage unavailable */
  }
}

// ---- Status section (MCP servers and SessionStart hooks)

export type McpTone = 'success' | 'warning' | 'destructive' | 'muted'

export interface McpRow {
  name: string
  tone: McpTone
  label: string
  // A short muted reason, only for servers that are not connected.
  reason: string | null
}

const MCP_VIEW: Record<McpServerInfo['status'], { tone: McpTone; label: string; reason: string | null }> = {
  connected: { tone: 'success', label: 'connected', reason: null },
  pending: { tone: 'warning', label: 'starting', reason: 'Still starting' },
  failed: { tone: 'destructive', label: 'failed', reason: 'Failed to connect' },
  'needs-auth': { tone: 'warning', label: 'needs sign-in', reason: 'Needs sign-in' },
  disabled: { tone: 'muted', label: 'disabled', reason: 'Turned off' },
}

const MCP_ORDER: McpServerInfo['status'][] = ['failed', 'needs-auth', 'pending', 'connected', 'disabled']
const byMcpOrder = (a: McpServerInfo, b: McpServerInfo) => MCP_ORDER.indexOf(a.status) - MCP_ORDER.indexOf(b.status) || a.name.localeCompare(b.name)

export function mcpRows(servers: McpServerInfo[]): McpRow[] {
  return [...servers].sort(byMcpOrder).map((s) => ({ name: s.name, ...MCP_VIEW[s.status] }))
}

export interface McpTile {
  name: string
  // 'claude.ai' for the claude.ai connectors, so the name itself stays short.
  prefix: string | null
  short: string
  tone: McpTone
  state: string
  // Failed and needs-sign-in servers get a tinted tile.
  attention: boolean
  reason: string | null
}

const MCP_STATE: Record<McpServerInfo['status'], string> = { connected: 'Connected', pending: 'Pending', failed: 'Failed', 'needs-auth': 'Needs sign-in', disabled: 'Disabled' }

// The name split into the claude.ai prefix and the rest; other names are returned whole.
export function mcpName(name: string): { prefix: string | null; short: string } {
  const prefix = name.startsWith('claude.ai ') && name.length > 'claude.ai '.length ? 'claude.ai' : null
  return { prefix, short: prefix ? name.slice(prefix.length + 1) : name }
}

export function mcpTiles(servers: McpServerInfo[]): McpTile[] {
  return [...servers].sort(byMcpOrder).map((s) => {
    const view = MCP_VIEW[s.status]
    return {
      name: s.name,
      ...mcpName(s.name),
      tone: s.status === 'pending' ? 'muted' : view.tone,
      state: MCP_STATE[s.status],
      attention: s.status === 'failed' || s.status === 'needs-auth',
      reason: view.reason,
    }
  })
}

// "MCP · 4 connected · 1 failed" (zero counts left out).
export function mcpSummary(servers: McpServerInfo[]): string {
  const parts = (['connected', 'pending', 'needs-auth', 'failed', 'disabled'] as const)
    .map((st) => [st, servers.filter((s) => s.status === st).length] as const)
    .filter(([, n]) => n > 0)
    .map(([st, n]) => `${n} ${MCP_VIEW[st].label}`)
  return ['MCP', ...parts].join(' · ')
}

// "superpowers:brainstorming" splits into the plugin and the skill; a plain name is returned whole.
function skillName(name: string): { prefix: string | null; short: string } {
  const i = name.indexOf(':')
  return i > 0 && i < name.length - 1 ? { prefix: name.slice(0, i), short: name.slice(i + 1) } : { prefix: null, short: name }
}

// One tile per skill the session called the Skill tool for: newest first, each skill once (its newest call decides the state).
export function skillTiles(items: ChatItem[]): McpTile[] {
  const seen = new Set<string>()
  const out: McpTile[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind !== 'tool' || it.name !== 'Skill') continue
    const name = it.summary || 'Skill'
    if (seen.has(name)) continue
    seen.add(name)
    const running = it.status === 'preparing' || it.status === 'running'
    const failed = it.status === 'failed' || it.status === 'denied'
    out.push({
      name,
      ...skillName(name),
      tone: running ? 'muted' : failed ? 'destructive' : 'success',
      state: running ? 'Loading…' : failed ? 'Failed' : 'Loaded',
      attention: failed,
      reason: failed ? (it.status === 'denied' ? 'Denied' : it.result?.summary || 'Failed to load') : null,
    })
  }
  return out
}

// "Skills · 3 loaded".
export function skillSummary(tiles: McpTile[]): string {
  return `Skills · ${tiles.filter((t) => t.state === 'Loaded').length} loaded`
}

export interface SessionRow {
  origin: string
  text: string
}

// The SessionStart hook messages the chat no longer shows.
export function sessionRows(items: ChatItem[]): SessionRow[] {
  const out: SessionRow[] = []
  for (const it of items) {
    if (it.kind !== 'notice' || it.category !== 'session') continue
    out.push({ origin: (it.origin ?? '').replace(/^SessionStart:?/, '') || 'SessionStart', text: it.text.replace(/^[^·]*hook · /, '') })
  }
  return out
}

const openKey = 'foreman.agents.status.open'

export function loadStatusOpen(): boolean {
  try {
    return localStorage.getItem(openKey) !== '0'
  } catch {
    return true
  }
}

export function saveStatusOpen(open: boolean): void {
  try {
    localStorage.setItem(openKey, open ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}
