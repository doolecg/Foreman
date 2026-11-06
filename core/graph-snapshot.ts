import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OrchestrationGraph } from '../shared/orchestration-graph'

// One JSON file per Orchestration project in Foreman's own data folder, so the graph view is not blank after a restart.

const VERSION = 1

export function snapshotFile(dir: string, crewId: number): string {
  return join(dir, `graph-${crewId}.json`)
}

// Temp file then rename, so a crash never leaves a half-written snapshot.
// The project folder is saved too: a crew id can be reused, and a snapshot of another folder must not load for it.
export function saveSnapshot(dir: string, crewId: number, folder: string, graph: OrchestrationGraph): void {
  const file = snapshotFile(dir, crewId)
  const tmp = `${file}.tmp-${process.pid}`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, JSON.stringify({ version: VERSION, folder, graph }), 'utf8')
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

// Whatever was running when the app closed is not running now: nothing survives a restart, and no event says how it ended.
export function asEnded(g: OrchestrationGraph): OrchestrationGraph {
  return {
    ...g,
    orch: 'idle',
    builder: g.builder === 'building' ? 'idle' : g.builder,
    opus: 'idle',
    council: {
      ui: g.council.ui === 'running' ? 'idle' : g.council.ui,
      code: g.council.code === 'running' ? 'idle' : g.council.code,
      run: g.council.run === 'running' ? 'idle' : g.council.run,
    },
    recall: { ...g.recall, run: false },
    subagents: g.subagents.map((a) => (a.status === 'running' ? { ...a, status: 'unknown' as const } : a)),
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const sameDir = (a: string, b: string): boolean => {
  const n = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return n(a) === n(b)
}

// A missing, unreadable or malformed file, or one saved for another folder (or by an older build that saved none), is an empty graph (null). Never throws.
export function loadSnapshot(dir: string, crewId: number, folder: string): OrchestrationGraph | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(snapshotFile(dir, crewId), 'utf8'))
    if (!isObj(parsed) || parsed.version !== VERSION || !isObj(parsed.graph)) return null
    if (typeof parsed.folder !== 'string' || !sameDir(parsed.folder, folder)) return null
    const g = parsed.graph
    if (typeof g.sessionId !== 'string' || !Array.isArray(g.subagents) || !isObj(g.council) || !isObj(g.recall)) return null
    return asEnded(g as unknown as OrchestrationGraph)
  } catch {
    return null
  }
}

export function deleteSnapshot(dir: string, crewId: number): void {
  rmSync(snapshotFile(dir, crewId), { force: true })
}
