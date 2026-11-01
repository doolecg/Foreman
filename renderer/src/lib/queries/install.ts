import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { decodeIpcError } from '@shared/ipc'
import { type InstallId, type InstallResult, type InstallStatusItem } from '@shared/install'
import { speechModelInstalled } from '@/lib/speechModel'
import { call } from './core'

export const installKey = ['install'] as const

// Core cannot see the speech model (the app window caches it), so this window fills that row in.
export const useInstallStatus = () =>
  useQuery({
    queryKey: installKey,
    queryFn: async (): Promise<InstallStatusItem[]> => {
      const items = await call('install:status')
      return items.map((s) => (s.id === 'dictation' ? { ...s, state: speechModelInstalled() ? 'installed' : 'missing' } : s))
    },
    staleTime: 60_000,
  })

async function runInstall(id: InstallId): Promise<InstallResult> {
  try {
    if (id === 'dictation') {
      const { preloadSpeechModel } = await import('@/components/chat/useDictation')
      await preloadSpeechModel()
      return { id, ok: true }
    }
    return await call('install:run', id)
  } catch (e) {
    return { id, ok: false, error: decodeIpcError(e).message || (e instanceof Error ? e.message : 'The install failed') }
  }
}

// Runs one install. Only call this after the user confirmed the command. Refreshes what depends on the tool afterwards.
export function useInstallRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: runInstall,
    onSettled: async () => {
      // The MCP runtime probe is cached in core; ask it to look again so a new tool shows up straight away.
      await call('mcp:optional', null, true).catch(() => undefined)
      await Promise.all(['install', 'superpowers', 'capabilities', 'mcp'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
  })
}

// Finds a program in its default places, asks for its file, or goes back to PATH. Refreshes what depends on the program afterwards.
export function useToolPath() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ op, id }: { op: 'find' | 'locate' | 'forget'; id: InstallId }) => call(`tools:${op}`, id),
    onSettled: () => Promise.all(['install', 'capabilities', 'mcp'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}
