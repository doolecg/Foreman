import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script, no types
import { MODEL_ENGINE_REASON, modelEngineStop } from '../scripts/model-engine-check.mjs'

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const result = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }
const use = (name: string, input: object = {}) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })
const file = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n')
const stop = (text: string, extra: object = {}) =>
  modelEngineStop({ hook_event_name: 'Stop', transcript_path: 'x.jsonl', ...extra }, () => text, () => 0)

describe('modelEngineStop', () => {
  it('blocks when the session edited and no council ran', () => {
    expect(stop(file(user('go'), use('Edit'), result))).toEqual({ decision: 'block', reason: MODEL_ENGINE_REASON })
  })
  it('blocks when a builder helper was called and no council ran', () => {
    expect(stop(file(user('go'), use('Agent', { subagent_type: 'builder' }), result))).toMatchObject({ decision: 'block' })
  })
  it('passes when a council helper ran this turn', () => {
    expect(stop(file(user('go'), use('Write'), use('Task', { subagent_type: 'council-code' })))).toBeNull()
  })
  it('blocks when an edit came after the council run', () => {
    expect(stop(file(user('go'), use('Edit'), use('Agent', { subagent_type: 'council-run' }), use('Write')))).toMatchObject({ decision: 'block' })
  })
  it('passes when the council ran after the last edit', () => {
    expect(stop(file(user('go'), use('Edit'), use('Write'), use('Agent', { subagent_type: 'council-run' })))).toBeNull()
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
