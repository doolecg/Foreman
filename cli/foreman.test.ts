import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { HELP, main, parseArgs, render } from './foreman'

describe('foreman CLI', () => {
  it('sends a shot file as an absolute path and passes kind through', () => {
    const p = parseArgs(['shot', 'out/a.png', '--kind', 'chat'])
    expect(p).toEqual({ kind: 'request', cmd: 'shot', args: { file: resolve('out/a.png'), kind: 'chat' }, json: false, stdin: null })
    expect(parseArgs(['shot', 'out/a.png'])).toMatchObject({ kind: 'request', args: { file: resolve('out/a.png') } })
  })

  it('treats a missing shot file as a usage error (exit 2)', async () => {
    const r = await main(['shot'], {})
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('Missing <file>')
  })

  it('lists shot in --help', () => {
    expect(HELP).toContain('foreman shot <file> [--kind K]')
  })

  it('has no memory command any more', () => {
    expect(parseArgs(['memory', 'recall', 'x'])).toMatchObject({ kind: 'error' })
    expect(HELP).not.toContain('memory')
  })

  it('refuses commands that were removed with the orchestration', () => {
    expect(parseArgs(['job', 'list'])).toMatchObject({ kind: 'error' })
    expect(parseArgs(['inbox'])).toMatchObject({ kind: 'error' })
  })

  it('prints the answer, or the error with its exit code', () => {
    expect(render({ exit: 0, out: 'ok' }, false)).toEqual({ stdout: 'ok\n', stderr: '', code: 0 })
    expect(render({ exit: 4, error: 'busy' }, false)).toEqual({ stdout: '', stderr: 'foreman: busy\n', code: 4 })
  })
})
