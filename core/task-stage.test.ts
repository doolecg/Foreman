import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listTasks, readTask, readTaskPlan, readTaskStages, watchTasks } from './task-stage'

let folder = ''
beforeEach(() => void (folder = mkdtempSync(join(tmpdir(), 'foreman-stage-'))))
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const task = (name: string, files: Record<string, string>, at?: number) => {
  const dir = join(folder, '.foreman', 'engineering', name)
  mkdirSync(dir, { recursive: true })
  for (const [f, text] of Object.entries(files)) {
    writeFileSync(join(dir, f), text)
    if (at) utimesSync(join(dir, f), at, at)
  }
}
const current = (folderPath: string) => readTaskStages(folderPath)?.find((s) => s.state === 'current')?.key

describe('readTaskStages', () => {
  it('is null when the project has no Engineering folder', () => {
    expect(readTaskStages(folder)).toBeNull()
  })

  it('is null when the Engineering folder holds no task', () => {
    mkdirSync(join(folder, '.foreman', 'engineering'), { recursive: true })
    expect(readTaskStages(folder)).toBeNull()
  })

  it('reads the stage of the only task', () => {
    task('a', { 'notes.html': 'n', 'spec.html': 's' })
    expect(current(folder)).toBe('spec')
  })

  it('reads the task whose files changed last', () => {
    task('old', { 'notes.html': 'n', 'spec.html': 's', 'slices.html': '<input type="checkbox" checked> 1. x' }, 1_000_000)
    task('new', { 'notes.html': 'n' }, 2_000_000)
    expect(current(folder)).toBe('frame')
  })

  it('counts the ticked slices of the newest task', () => {
    task('a', { 'spec.html': 's', 'slices.html': '<input type="checkbox" checked> 1. x <input type="checkbox"> 2. y' })
    expect(readTaskStages(folder)?.find((s) => s.key === 'build')?.detail).toBe('1 of 2')
  })
})

describe('readTask', () => {
  it('titles the task with its spec title without the "Spec: " lead', () => {
    task('stage-box', { 'spec.html': '<title>Spec: stage box and history lines</title>' })
    expect(readTask(folder)).toMatchObject({ name: 'stage-box', title: 'stage box and history lines' })
  })

  it('falls back to the folder name as words', () => {
    task('stage-box', { 'notes.html': '<p>no title</p>' })
    expect(readTask(folder)?.title).toBe('Stage box')
  })

  it('hides a task whose files did not change after it was cleared, and shows it again when they do', () => {
    task('a', { 'spec.html': 's' }, 1_000)
    expect(readTask(folder, 2_000_000)).toBeNull()
    task('a', { 'slices.html': 'x' }, 3_000)
    expect(readTask(folder, 2_000_000)?.name).toBe('a')
  })
})

describe('listTasks', () => {
  it('is empty without an Engineering folder', () => {
    expect(listTasks(folder)).toEqual([])
  })

  it('lists every task newest first with the time its newest file changed', () => {
    task('old', { 'spec.html': 's' }, 1_000_000)
    task('new', { 'notes.html': 'n', 'spec.html': '<title>Spec: Newer</title>' }, 2_000_000)
    const list = listTasks(folder)
    expect(list.map((t) => t.name)).toEqual(['new', 'old'])
    expect(list[0]).toMatchObject({ title: 'Newer', updatedAt: 2_000_000_000 })
    expect(list[1]?.stages.find((s) => s.state === 'current')?.key).toBe('spec')
  })
})

describe('readTaskPlan', () => {
  it('is null without a task, and when the task was cleared', () => {
    expect(readTaskPlan(folder)).toBeNull()
    task('a', { 'spec.html': 's' }, 1_000)
    expect(readTaskPlan(folder, 2_000_000)).toBeNull()
  })

  it('gives the gate, slices, spec title and spec path of the newest task', () => {
    task('a', { 'spec.html': '<title>Spec: Toggles</title>', 'slices.html': '<input type="checkbox" checked> 1. One <input type="checkbox"> 2. Two' })
    expect(readTaskPlan(folder)).toMatchObject({
      name: 'a',
      gate: 'approved',
      specTitle: 'Toggles',
      specPath: '.foreman/engineering/a/spec.html',
      slices: [
        { label: '1. One', done: true, current: false },
        { label: '2. Two', done: false, current: true },
      ],
    })
  })

  it('has no spec title or path without a spec page', () => {
    task('a', { 'notes.html': 'n' })
    expect(readTaskPlan(folder)).toMatchObject({ gate: 'none', slices: [], specTitle: null, specPath: null })
  })
})

// `poke` changes the folder again every half second while waiting: macOS reports a change made just after a watch starts only sometimes.
const nextCall = (calls: { n: number }, from: number, poke?: () => void) =>
  new Promise<void>((resolve, reject) => {
    const t0 = Date.now()
    let last = t0
    const id = setInterval(() => {
      if (calls.n > from) (clearInterval(id), resolve())
      else if (Date.now() - t0 > 8000) (clearInterval(id), reject(new Error('no change was reported')))
      else if (poke && Date.now() - last > 500) (last = Date.now(), poke())
    }, 20)
  })

describe('watchTasks', () => {
  it('reports a change to a file in the task folder', async () => {
    task('a', { 'notes.html': 'n' })
    const calls = { n: 0 }
    const stop = watchTasks(folder, () => calls.n++)
    try {
      // macOS starts its file-event stream a moment after watch() returns and misses a change made before then.
      await new Promise((r) => setTimeout(r, 500))
      task('a', { 'spec.html': 's' })
      await nextCall(calls, 0, () => task('a', { 'spec.html': String(Math.random()) }))
    } finally {
      stop()
    }
  })

  it('keeps reporting after the Engineering folder is created later', async () => {
    const calls = { n: 0 }
    const stop = watchTasks(folder, () => calls.n++)
    try {
      task('a', { 'notes.html': 'n' })
      await nextCall(calls, 0)
      await new Promise((r) => setTimeout(r, 400))
      const before = calls.n
      task('a', { 'spec.html': 's' })
      await nextCall(calls, before, () => task('a', { 'spec.html': String(Math.random()) }))
    } finally {
      stop()
    }
  })

  it('reports nothing after it is stopped', async () => {
    task('a', { 'notes.html': 'n' })
    const calls = { n: 0 }
    watchTasks(folder, () => calls.n++)()
    task('a', { 'spec.html': 's' })
    await new Promise((r) => setTimeout(r, 400))
    expect(calls.n).toBe(0)
  })
})
