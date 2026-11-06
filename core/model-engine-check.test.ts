import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script, no types
import { modelEngineStop } from '../scripts/model-engine-check.mjs'

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const result = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }
const use = (name: string, input: object = {}) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })
const file = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n')
const stop = (text: string, extra: object = {}) =>
  modelEngineStop({ hook_event_name: 'Stop', transcript_path: 'x.jsonl', ...extra }, () => text, () => 0)

describe('modelEngineStop', () => {
  it('blocks when the session edited and no council ran', () => {
    expect(stop(file(user('go'), use('Edit'), result))).toEqual({ decision: 'block', reason: 'Model Engine: run council-run and council-code on the diff before saying done.' })
  })
  it('blocks when a builder helper was called and no council ran', () => {
    expect(stop(file(user('go'), use('Agent', { subagent_type: 'builder' }), result))).toMatchObject({ decision: 'block' })
  })
  it('passes when a council helper ran this turn', () => {
    expect(stop(file(user('go'), use('Write'), use('Task', { subagent_type: 'council-code' }), use('Task', { subagent_type: 'council-run' })))).toBeNull()
  })
  it('blocks when an edit came after the council run', () => {
    expect(stop(file(user('go'), use('Edit'), use('Agent', { subagent_type: 'council-run' }), use('Write')))).toMatchObject({ decision: 'block' })
  })
  it('passes when the council ran after the last edit', () => {
    expect(stop(file(user('go'), use('Edit'), use('Write'), use('Agent', { subagent_type: 'council-run' }), use('Agent', { subagent_type: 'council-code' })))).toBeNull()
  })
  it('names only the missing members when one council ran', () => {
    expect(stop(file(user('go'), use('Edit'), use('Agent', { subagent_type: 'council-run' })))).toMatchObject({
      reason: 'Model Engine: run council-code on the diff before saying done.',
    })
  })
  it('a non-UI edit needs run and code only', () => {
    const r = stop(file(user('go'), use('Edit', { file_path: 'E:\\x\\core\\foreman.ts' })))
    expect(r.reason).not.toContain('council-ui')
  })
  it('a UI edit also needs council-ui', () => {
    const r = stop(file(user('go'), use('Edit', { file_path: 'E:/x/renderer/App.tsx' })))
    expect(r.reason).toBe('Model Engine: run council-run and council-code and council-ui on the diff before saying done.')
    const done = file(user('go'), use('Edit', { file_path: 'a.css' }), ...['run', 'code'].map((k) => use('Agent', { subagent_type: `council-${k}` })))
    expect(stop(done)).toMatchObject({ reason: 'Model Engine: run council-ui on the diff before saying done.' })
  })
  it('a UI edit after the last council-ui call blocks on ui only', () => {
    const councils = ['run', 'ui', 'code'].map((k) => use('Agent', { subagent_type: `council-${k}` }))
    expect(stop(file(user('go'), use('Edit', { file_path: 'a.tsx' }), ...councils))).toBeNull()
    expect(stop(file(user('go'), use('Edit', { file_path: 'a.ts' }), ...councils, use('Edit', { file_path: 'a.tsx' })))).toMatchObject({ decision: 'block' })
  })
  it('docs-only edits need no council', () => {
    expect(stop(file(user('go'), use('Write', { file_path: 'notes.md' }), use('Edit', { file_path: 'E:\\x\\01_Plan\\p.html' }), use('Edit', { file_path: '00_Bible/bible.html' })))).toBeNull()
  })
  it('a builder prompt mentioning renderer/ needs council-ui', () => {
    const r = stop(file(user('go'), use('Agent', { subagent_type: 'builder', prompt: 'edit renderer/App.tsx' })))
    expect(r.reason).toContain('council-ui')
    expect(stop(file(user('go'), use('Agent', { subagent_type: 'builder', prompt: 'edit core/a.ts' }))).reason).not.toContain('council-ui')
  })
  it('fails open on a transcript over 20 MB', () => {
    expect(modelEngineStop({ hook_event_name: 'Stop', transcript_path: 'x' }, () => file(user('go'), use('Edit')), () => 21 * 1024 * 1024)).toBeNull()
  })
  it('passes when nothing was edited', () => {
    expect(stop(file(user('go'), use('Read'), use('Agent', { subagent_type: 'recall' })))).toBeNull()
  })
  it('only looks at the current turn', () => {
    expect(stop(file(user('one'), use('Edit'), result, user('two'), use('Read')))).toBeNull()
  })
  it('passes when stop_hook_active is true', () => {
    expect(stop(file(user('go'), use('Edit')), { stop_hook_active: true })).toBeNull()
  })
  it('fails open on a bad transcript, a missing path or a read error', () => {
    expect(stop('not json\n{"torn')).toBeNull()
    expect(modelEngineStop({ hook_event_name: 'Stop' }, () => '')).toBeNull()
    expect(modelEngineStop({ hook_event_name: 'Stop', transcript_path: 'x' }, () => { throw new Error('gone') })).toBeNull()
  })
})
