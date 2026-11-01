import { EventEmitter } from 'node:events'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChatSession, type ChatChild, type ChatSpawnSpec } from './claude-chat'

const root = mkdtempSync(join(tmpdir(), 'foreman-rewind-'))
process.on('exit', () => rmSync(root, { recursive: true, force: true }))

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { write: () => true, end: () => this.emit('close', 0, null), on: () => undefined }
  kill() {
    this.emit('close', null, 'SIGTERM')
  }
}

const user = (uuid: string, content: unknown) => ({ type: 'user', uuid, message: { role: 'user', content } })
const reply = (uuid: string, id: string, content: unknown[]) => ({ type: 'assistant', uuid, message: { id, role: 'assistant', model: 'claude-test', content } })
const TRANSCRIPT = [
  user('u1', 'first prompt'),
  reply('a1', 'm1', [{ type: 'text', text: 'ok' }]),
  user('u2', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'second prompt' }]),
  reply('a2', 'm2', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'x.txt' } }]),
  user('r1', [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }]),
  reply('a3', 'm3', [{ type: 'text', text: 'edited' }]),
]

function setup(run?: (spec: ChatSpawnSpec) => { code: number | null; stdout: string; stderr: string }) {
  const dir = mkdtempSync(join(root, 't-'))
  const transcriptFile = join(dir, 's1.jsonl')
  writeFileSync(transcriptFile, `${TRANSCRIPT.map((l) => JSON.stringify(l)).join('\n')}\n`)
  const events: string[] = []
  const spawned: ChatSpawnSpec[] = []
  const runs: ChatSpawnSpec[] = []
  const sessions: string[] = []
  const children: FakeChild[] = []
  const session = new ChatSession({
    scratchId: 1,
    sessionId: 's1',
    cwd: dir,
    transcriptFile,
    launch: (resume, sid) => ({ file: 'claude', args: ['-p', ...(resume ? ['--resume', sid] : ['--session-id', sid])], cwd: dir, env: { CHECKPOINT: '1' }, shell: false }),
    filesFor: (sid) => ({ transcriptFile: join(dir, `${sid}.jsonl`) }),
    onSession: (sid) => sessions.push(sid),
    runClaude: async (spec) => {
      events.push('run')
      runs.push(spec)
      return run ? run(spec) : { code: 0, stdout: 'Files rewound', stderr: '' }
    },
    spawn: (spec) => {
      events.push('spawn')
      spawned.push(spec)
      const c = new FakeChild()
      children.push(c)
      return c as unknown as ChatChild
    },
    emit: () => undefined,
  })
  session.snapshot()
  session.start()
  return { session, transcriptFile, events, spawned, runs, sessions, children }
}

const ids = (s: ChatSession) => s.state.items.filter((i) => i.kind === 'user').map((i) => i.id)

describe('ChatSession /clear', () => {
  it('empties the chat and starts a new session on the next message, without sending the text to Claude', async () => {
    const h = setup()
    h.session.send({ text: '/clear' })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.session.state.items).toEqual([])
    const newId = h.sessions[0]!
    expect(newId).toMatch(/^[0-9a-f-]{36}$/)
    expect(h.session.state.sessionId).toBe(newId)
    h.session.send({ text: 'hello again' })
    expect(h.spawned[h.spawned.length - 1]!.args).toEqual(['-p', '--session-id', newId])
  })
})

describe('ChatSession.rewind', () => {
  it('forks the session at the entry before the message and returns its text and images', async () => {
    const h = setup()
    expect(await h.session.rewind('u2', false)).toEqual({ text: 'second prompt', images: [{ mediaType: 'image/png', base64: 'AAAA' }] })
    expect(h.spawned).toHaveLength(2)
    const args = h.spawned[1]!.args
    const newId = h.sessions[0]!
    expect(newId).toMatch(/^[0-9a-f-]{36}$/)
    expect(args).toEqual(['-p', '--resume', 's1', '--resume-session-at', 'a1', '--fork-session', '--session-id', newId])
    expect(h.runs).toHaveLength(0)
    expect(ids(h.session)).toEqual(['u1'])
    expect(h.session.state.sessionId).toBe(newId)
  })

  it('reverts the files first, and aborts without changing anything when that fails', async () => {
    const ok = setup()
    await ok.session.rewind('u2', true)
    expect(ok.events).toEqual(['spawn', 'run', 'spawn'])
    expect(ok.runs[0]!.args).toEqual(['-p', '--resume', 's1', '--rewind-files', 'u2'])
    expect(ok.runs[0]!.env).toEqual({ CHECKPOINT: '1' })

    const bad = setup(() => ({ code: 1, stdout: '', stderr: 'No file checkpoint found for this message\n' }))
    await expect(bad.session.rewind('u2', true)).rejects.toThrow('No file checkpoint found for this message')
    expect(bad.sessions).toEqual([])
    expect(ids(bad.session)).toEqual(['u1', 'u2'])
    expect(bad.session.state.sessionId).toBe('s1')
    expect(bad.spawned[bad.spawned.length - 1]!.args).toEqual(['-p', '--resume', 's1'])
  })

  it('starts a fresh session, with no resume, for the first prompt', async () => {
    const h = setup()
    expect(await h.session.rewind('u1', false)).toEqual({ text: 'first prompt', images: [] })
    expect(h.spawned[1]!.args).toEqual(['-p', '--session-id', h.sessions[0]!])
    expect(ids(h.session)).toEqual([])
  })

  it('finds a message sent in this run by its text', async () => {
    const h = setup()
    h.session.send({ text: 'live prompt' })
    appendFileSync(h.transcriptFile, `${JSON.stringify(user('u9', 'live prompt'))}\n`)
    const live = h.session.state.items.find((i) => i.kind === 'user' && i.text === 'live prompt')!
    expect(live.id).not.toBe('u9')
    expect(await h.session.rewind(live.id, false)).toEqual({ text: 'live prompt', images: [] })
    expect(h.spawned[1]!.args).toContain('--resume-session-at')
    expect(h.spawned[1]!.args).toContain('a3')
    expect(ids(h.session)).toEqual(['u1', 'u2'])
  })

  it('refuses a message that is not in the transcript or not a sent message', async () => {
    const h = setup()
    await expect(h.session.rewind('nope', false)).rejects.toThrow('Only a message')
    const a = h.session.state.items.find((i) => i.kind === 'text')!
    await expect(h.session.rewind(a.id, false)).rejects.toThrow('Only a message')
    h.session.send({ text: 'never saved' })
    const unsaved = h.session.state.items.find((i) => i.kind === 'user' && i.text === 'never saved')!
    await expect(h.session.rewind(unsaved.id, false)).rejects.toThrow('has not saved this message')
    expect(h.sessions).toEqual([])
  })

  it('refuses while Claude waits for an answer', async () => {
    const h = setup()
    for (const l of readFileSync(join(__dirname, 'fixtures', 'chat', 'perm.jsonl'), 'utf8').split('\n')) if (l) h.children[0]!.stdout.emit('data', `${l}\n`)
    expect(h.session.mapper.hasPending()).toBe(true)
    await expect(h.session.rewind('u2', false)).rejects.toThrow('waiting for your answer')
    expect(h.sessions).toEqual([])
  })
})
