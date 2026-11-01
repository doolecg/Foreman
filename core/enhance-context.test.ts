import { describe, expect, it } from 'vitest'
import { gatherEnhanceContext, recentMessages } from './enhance-context'
import type { ChatItem } from '../shared/claude-chat'

describe('enhance context', () => {
  it('gathers the folder, git and recent conversation as the session', async () => {
    const c = await gatherEnhanceContext({
      folder: 'C:/p/app',
      git: async () => '## dev-1.0\n M a.ts',
      messages: () => [
        { role: 'user', text: 'make the login faster' },
        { role: 'assistant', text: 'Done, see a.ts', tools: ['Edit'] },
      ],
    })
    expect(c.session).toEqual([
      'Folder: C:/p/app',
      'Git branch: dev-1.0',
      'Git: 1 changed file: a.ts',
      'Recent conversation:',
      'Person: make the login faster',
      'Claude: Done, see a.ts [used Edit]',
    ])
    expect(c.sessionNote).toBe('')
  })
  it('names why the session is missing', async () => {
    const empty = await gatherEnhanceContext({})
    expect(empty.sessionNote).toBe('no session context')
    const slow = await gatherEnhanceContext({ git: () => Promise.reject(new Error('x')) })
    expect(slow.sessionNote).toBe('git unavailable')
  })
  it('reads the main thread of a chat as messages and leaves sub-agent work out', () => {
    const item = (o: Record<string, unknown>) => o as unknown as ChatItem
    const items = [
      item({ kind: 'user', parent: null, text: 'fix it' }),
      item({ kind: 'text', parent: null, md: 'On it.' }),
      item({ kind: 'tool', parent: null, name: 'Read' }),
      item({ kind: 'text', parent: 'agent-1', md: 'sub-agent chatter' }),
      item({ kind: 'text', parent: null, md: 'Fixed.' }),
      item({ kind: 'user', parent: null, text: 'thanks' }),
    ]
    expect(recentMessages(items)).toEqual([
      { role: 'user', text: 'fix it' },
      { role: 'assistant', text: 'On it. Fixed.', tools: ['Read'] },
      { role: 'user', text: 'thanks' },
    ])
  })
})
