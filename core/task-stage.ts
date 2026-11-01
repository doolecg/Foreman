import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { taskPlan, taskStages, type StageLine, type TaskInfo, type TaskListItem, type TaskPlan } from '../shared/engineering'

const tasksDir = (folder: string) => join(folder, '.foreman', 'engineering')

// The files of one task folder with the time the newest of them changed.
function readTask1(dir: string): { files: string[]; at: number } {
  const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  const at = files.reduce((max, f) => Math.max(max, statSync(join(dir, f)).mtimeMs), 0)
  return { files, at }
}

// A readable name for the task: the <title> of its spec, notes or slices page without the "Spec: " lead, else the folder name.
function taskTitle(dir: string, files: string[], name: string): string {
  for (const f of ['spec.html', 'notes.html', 'slices.html']) {
    if (!files.includes(f)) continue
    const t = /<title[^>]*>([^<]*)<\/title>/i.exec(readFileSync(join(dir, f), 'utf8'))?.[1]?.replace(/^\s*(spec|notes|slices)\s*:\s*/i, '').trim()
    if (t) return t
  }
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface TaskFolder {
  name: string
  dir: string
  files: string[]
  at: number
}

// Every task folder of the project, the one whose files changed last first.
function taskFolders(folder: string): TaskFolder[] {
  const root = tasksDir(folder)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, dir: join(root, e.name), ...readTask1(join(root, e.name)) }))
    .sort((a, b) => b.at - a.at)
}

const slicesOf = (t: TaskFolder) => (t.files.includes('slices.html') ? readFileSync(join(t.dir, 'slices.html'), 'utf8') : null)
const infoOf = (t: TaskFolder, slices: string | null): TaskInfo => ({ name: t.name, title: taskTitle(t.dir, t.files, t.name), stages: taskStages(t.files, slices) })

// The newest task whose files changed after `clearedAt`; null when there is none.
function newestTask(folder: string, clearedAt: number): TaskFolder | null {
  const best = taskFolders(folder)[0]
  return best && best.at > clearedAt ? best : null
}

// The project's newest Engineering task (the one whose files changed last, and after `clearedAt`); null when there is none.
export function readTask(folder: string, clearedAt = 0): TaskInfo | null {
  const best = newestTask(folder, clearedAt)
  return best ? infoOf(best, slicesOf(best)) : null
}

// Every Engineering task of the project, newest first, each with when its newest file changed.
export function listTasks(folder: string): TaskListItem[] {
  return taskFolders(folder).map((t) => ({ ...infoOf(t, slicesOf(t)), updatedAt: t.at }))
}

// The newest task with its plan gate, slices and spec (what the Plan panel shows); null when there is none.
export function readTaskPlan(folder: string, clearedAt = 0): TaskPlan | null {
  const best = newestTask(folder, clearedAt)
  if (!best) return null
  const slices = slicesOf(best)
  const hasSpec = best.files.includes('spec.html')
  const specTitle = hasSpec ? (/<title[^>]*>([^<]*)<\/title>/i.exec(readFileSync(join(best.dir, 'spec.html'), 'utf8'))?.[1]?.replace(/^\s*spec\s*:\s*/i, '').trim() || null) : null
  return {
    ...infoOf(best, slices),
    ...taskPlan(best.files, slices, specTitle),
    specPath: hasSpec ? `.foreman/engineering/${best.name}/spec.html` : null,
  }
}

export const readTaskStages = (folder: string): StageLine[] | null => readTask(folder)?.stages ?? null

const DEBOUNCE_MS = 50

// Calls onChange (debounced) when anything under the project's Engineering folder changes. Until that folder exists it
// watches the deepest existing parent, and moves down as the folders appear, so nothing is polled.
export function watchTasks(folder: string, onChange: () => void): () => void {
  // Windows reports long names: watching an 8.3 short path (C:\Users\ABCDEF~1) trips a libuv assertion that kills the process.
  if (!existsSync(folder)) return () => {}
  const real = realpathSync.native(folder)
  const levels = [tasksDir(real), join(real, '.foreman'), real]
  let watcher: FSWatcher | null = null
  let level = -1
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const arm = () => {
    const next = levels.findIndex((d) => existsSync(d))
    if (next === level || next < 0) return
    watcher?.close()
    level = next
    try {
      watcher = watch(levels[next]!, { recursive: next === 0 }, (_, name) => {
        // Above the Engineering folder only the next folder down matters, not every file of the project.
        if (next === 0 || name === (next === 1 ? 'engineering' : '.foreman')) fire()
      })
      watcher.on('error', () => {})
    } catch {
      watcher = null
      level = -1
    }
  }
  function fire() {
    if (stopped) return
    // The watcher is swapped from the timer, not from its own callback: closing a watcher inside its callback crashes Node on Windows.
    timer ??= setTimeout(() => {
      timer = null
      if (stopped) return
      arm()
      onChange()
    }, DEBOUNCE_MS)
  }

  arm()
  return () => {
    stopped = true
    watcher?.close()
    if (timer) clearTimeout(timer)
  }
}
