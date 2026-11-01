import { join } from 'node:path'
import type { SetupApplyResult, SetupItemView, SetupPlanView } from '../shared/setup'
import { loadCatalog, planSetup } from './setup-catalog'
import { writeSetup } from './setup-write'

// The two calls the app makes: show what a prompt would switch on, then write the ticked items into the project.
export function setupLibraryDir(claudeDir: string): string {
  return join(claudeDir, 'library')
}

export function planView(libraryDir: string, prompt: string, preset?: string): SetupPlanView {
  const catalog = loadCatalog(libraryDir)
  const plan = planSetup(catalog, prompt, preset)
  const items: SetupItemView[] = plan.picks.map((p) => ({ kind: p.kind, name: p.name, why: p.why, needed: catalog[p.kind][p.name]?.needed_when ?? '' }))
  return { preset: plan.preset, presets: Object.keys(catalog.presets), items }
}

export function applySetup(libraryDir: string, folder: string, prompt: string, selected: Array<{ kind: string; name: string }>, date: string, preset?: string): SetupApplyResult {
  const catalog = loadCatalog(libraryDir)
  const plan = planSetup(catalog, prompt, preset)
  plan.picks = plan.picks.filter((p) => selected.some((s) => s.kind === p.kind && s.name === p.name))
  return writeSetup(folder, catalog, plan, date)
}
