export interface ProjectModes {
  engineering: boolean
  factory: boolean
}

// The skill pack in <userData>/engineering: the files the owner edited (relative to that folder) and the folder.
export interface EngineeringStatus {
  edited: string[]
  folder: string
}

export interface PackDirs {
  // <userData>/engineering/engineering.
  engineeringDir: string
}

// The newest Engineering task of a project: its folder name, a readable title and where it stands.
export interface TaskInfo {
  name: string
  title: string
  stages: StageLine[]
}

export type StageKey = 'frame' | 'spec' | 'slices' | 'plan' | 'build' | 'ship'

export interface StageLine {
  key: StageKey
  label: string
  state: 'done' | 'current' | 'todo'
  detail?: string
}

// A numbered slice line in slices.html: a checkbox (or [x] / [ ]) followed by "3." - criteria boxes have no number, so they are not counted.
const SLICE_RE = /(<input[^>]*type=["']?checkbox["']?[^>]*>|\[[ xX]\])\s*(?:<[^>]+>\s*)*(\d+\.(?:(?!<input[^>]*type=["']?checkbox|\[[ xX]\])[^\n])*)/g

// A task folder of the project with when its newest file changed (ms since epoch).
export interface TaskListItem extends TaskInfo {
  updatedAt: number
}

export type PlanGate = 'none' | 'waiting' | 'approved'

export interface PlanSlice {
  label: string
  done: boolean
  // The first slice not ticked yet.
  current: boolean
}

export interface TaskPlan extends TaskInfo {
  gate: PlanGate
  slices: PlanSlice[]
  // The spec page's <title> without the "Spec: " lead; null when the task has no spec page.
  specTitle: string | null
  // Project-relative path of spec.html (for docs:open); null when the task has no spec page.
  specPath: string | null
}

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

// The numbered slices of slices.html in order: the text after the box up to the end of its line, tags removed.
function readSlices(html: string | null): Array<{ label: string; done: boolean }> {
  return [...(html?.matchAll(SLICE_RE) ?? [])].map((m) => ({ label: decode(m[2]!.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(), done: /checked|\[[xX]\]/.test(m[1]!) }))
}

// The Plan panel's data: the plan gate from the stages (nothing before the plan exists, waiting until the first slice is
// ticked, then approved) and the slices with the first unticked one marked current.
export function taskPlan(files: readonly string[], slicesHtml: string | null, specTitle: string | null): Pick<TaskPlan, 'gate' | 'slices' | 'specTitle'> {
  const plan = taskStages(files, slicesHtml).find((s) => s.key === 'plan')
  const slices = readSlices(slicesHtml)
  const at = slices.findIndex((s) => !s.done)
  return {
    gate: plan?.state === 'done' ? 'approved' : plan?.state === 'current' ? 'waiting' : 'none',
    slices: slices.map((s, i) => ({ ...s, current: i === at })),
    specTitle,
  }
}

export function countSlices(html: string | null): { ticked: number; total: number } {
  let ticked = 0
  let total = 0
  for (const m of html?.matchAll(SLICE_RE) ?? []) {
    total++
    if (/checked|\[[xX]\]/.test(m[1]!)) ticked++
  }
  return { ticked, total }
}

// Where an Engineering task is, read from the files in its folder: the first stage not finished is the current one. Ship is never "done".
export function taskStages(files: readonly string[], slicesHtml: string | null): StageLine[] {
  const has = (f: string) => files.includes(f)
  const { ticked, total } = countSlices(slicesHtml)
  const stages: Array<[StageKey, string, boolean, string?]> = [
    ['frame', 'Frame', has('spec.html'), undefined],
    ['spec', 'Spec', has('slices.html'), undefined],
    ['slices', 'Slices', total > 0, undefined],
    ['plan', 'Plan OK', ticked > 0, 'waiting for your OK'],
    ['build', 'Build', total > 0 && ticked === total, total > 0 ? `${ticked} of ${total}` : undefined],
    ['ship', 'Ship', false, undefined],
  ]
  const at = stages.findIndex((s) => !s[2])
  return stages.map(([key, label, , detail], i) => {
    const state = i < at ? 'done' : i === at ? 'current' : 'todo'
    return { key, label, state, ...(detail && (state === 'current' || (key === 'build' && ticked > 0)) ? { detail } : {}) }
  })
}

// The block added to a Claude tile's appended system prompt for the project's modes; '' when Engineering is off.
export function buildPreamble(modes: ProjectModes, dirs: PackDirs): string {
  const at = (dir: string, rest: string) => `${dir.replace(/[\\/]+$/, '')}/${rest}`
  const blocks: string[] = []
  if (modes.engineering) {
    blocks.push(
      `Engineering Mode is on for this project. For every new task read ${at(dirs.engineeringDir, 'skills/flow/SKILL.md')} and follow it. Read each stage skill file before using that stage. One approval gate: the plan. Never push. Max 3 verify passes then ask. Task files live in .foreman/engineering/<task-name>/.`,
    )
  }
  return blocks.join('\n\n')
}
