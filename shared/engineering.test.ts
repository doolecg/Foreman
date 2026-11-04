import { describe, expect, it } from 'vitest'
import { buildPreamble, taskPlan, taskStages } from './engineering'

const row = (box: string, n: number) => `<li>${box} <b>${n}. Title</b></li>`
const slices = (ticked: number, total: number) => Array.from({ length: total }, (_, i) => row(i < ticked ? '<input type="checkbox" checked>' : '<input type="checkbox">', i + 1)).join('\n')
const at = (files: string[], html: string | null = null) => taskStages(files, html).map((s) => `${s.key}:${s.state}`).join(' ')

const dirs = { engineeringDir: 'C:\\Data\\engineering\\engineering' }

describe('taskPlan', () => {
  const files = ['spec.html', 'slices.html']

  it('has no gate before there is a numbered slice', () => {
    expect(taskPlan(['spec.html'], null, 'x')).toMatchObject({ gate: 'none', slices: [] })
    expect(taskPlan(files, '<h1>Slices</h1>', null).gate).toBe('none')
  })

  it('waits for the OK while no slice is ticked and marks the first slice current', () => {
    const p = taskPlan(files, slices(0, 2), 'x')
    expect(p.gate).toBe('waiting')
    expect(p.slices).toEqual([
      { label: '1. Title', done: false, current: true },
      { label: '2. Title', done: false, current: false },
    ])
  })

  it('is approved once a slice is ticked; the first unticked one is current', () => {
    const p = taskPlan(files, slices(1, 3), 'x')
    expect(p.gate).toBe('approved')
    expect(p.slices.map((s) => `${s.done}:${s.current}`)).toEqual(['true:false', 'false:true', 'false:false'])
  })

  it('has no current slice when all are ticked, and keeps the spec title', () => {
    const p = taskPlan(files, slices(2, 2), 'Stage box')
    expect(p.gate).toBe('approved')
    expect(p.slices.some((s) => s.current)).toBe(false)
    expect(p.specTitle).toBe('Stage box')
  })

  it('reads labels from the [x] text style and from several boxes on one line, without tags or entities', () => {
    const p = taskPlan(files, '[x] 1. Mods &amp; hooks\n  <input type="checkbox"> criterion\n<input type="checkbox" checked> 2. <code>ModeToggles</code> <input type="checkbox"> 3. Last', null)
    expect(p.slices.map((s) => s.label)).toEqual(['1. Mods & hooks', '2. ModeToggles', '3. Last'])
    expect(p.slices.map((s) => s.done)).toEqual([true, true, false])
  })
})

describe('taskStages', () => {
  it('lists the six stages in order with their labels', () => {
    expect(taskStages(['notes.html'], null).map((s) => s.label)).toEqual(['Frame', 'Spec', 'Slices', 'Plan OK', 'Build', 'Ship'])
  })

  it('is at Frame with only the notes page', () => {
    expect(at(['notes.html'])).toBe('frame:current spec:todo slices:todo plan:todo build:todo ship:todo')
  })

  it('is at Spec once the spec page exists', () => {
    expect(at(['notes.html', 'spec.html'])).toBe('frame:done spec:current slices:todo plan:todo build:todo ship:todo')
  })

  it('is at Slices when the slices page has no numbered slice yet', () => {
    expect(at(['notes.html', 'spec.html', 'slices.html'], '<h1>Slices</h1>')).toBe('frame:done spec:done slices:current plan:todo build:todo ship:todo')
  })

  it('waits for the plan OK when no slice is ticked', () => {
    const s = taskStages(['notes.html', 'spec.html', 'slices.html'], slices(0, 4))
    expect(s.map((x) => `${x.key}:${x.state}`).join(' ')).toBe('frame:done spec:done slices:done plan:current build:todo ship:todo')
    expect(s[3]?.detail).toBe('waiting for your OK')
  })

  it('is building with a count once a slice is ticked', () => {
    const s = taskStages(['spec.html', 'slices.html'], slices(2, 5))
    expect(s.map((x) => `${x.key}:${x.state}`).join(' ')).toBe('frame:done spec:done slices:done plan:done build:current ship:todo')
    expect(s[4]?.detail).toBe('2 of 5')
  })

  it('is at Ship when every slice is ticked', () => {
    expect(at(['spec.html', 'slices.html'], slices(3, 3))).toBe('frame:done spec:done slices:done plan:done build:done ship:current')
  })

  it('counts the [x] and [ ] text style and ignores criteria boxes', () => {
    const html = '[x] 1. First\n  <input type="checkbox" checked> criterion\n[ ] 2. Second\n  <input type="checkbox"> criterion'
    expect(taskStages(['spec.html', 'slices.html'], html)[4]?.detail).toBe('1 of 2')
  })

  it('treats a slices page that cannot be read as having no slices', () => {
    expect(at(['spec.html', 'slices.html'], null)).toBe('frame:done spec:done slices:current plan:todo build:todo ship:todo')
  })
})

describe('buildPreamble', () => {
  it('is empty when both modes are off', () => {
    expect(buildPreamble({ engineering: false, factory: false }, dirs)).toBe('')
  })

  it('names the flow skill and the rules when only Engineering is on', () => {
    const t = buildPreamble({ engineering: true, factory: false }, dirs)
    expect(t).toContain('Engineering Mode is on')
    expect(t).toContain('C:\\Data\\engineering\\engineering/skills/flow/SKILL.md')
    expect(t).toContain('Never push')
    expect(t).not.toContain('Factory')
  })

  it('adds nothing for Orchestration alone: its kit lives in the project', () => {
    expect(buildPreamble({ engineering: false, factory: true }, dirs)).toBe('')
  })

  it('gives Engineering the same text with Orchestration on or off, and stays short', () => {
    const t = buildPreamble({ engineering: true, factory: true }, dirs)
    expect(t).toContain('Engineering Mode is on')
    expect(t).not.toContain('Orchestration')
    expect(t).toBe(buildPreamble({ engineering: true, factory: false }, dirs))
    expect(t.split(/\s+/).length).toBeLessThan(350)
  })
})
