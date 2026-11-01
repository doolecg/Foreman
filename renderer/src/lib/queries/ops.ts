import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { call, registerLive, useMutate } from './core'

// Backups, Superpowers, CLI capabilities and Claude tile state.

export const useBackups = () => useQuery({ queryKey: ['backups'] as const, queryFn: () => call('backup:list') })
export const useCreateBackup = () => useMutate('backup:create', [['backups']])
export const useRestoreBackup = () => useMutate('backup:restore', [])
export const useDeleteBackup = () => useMutate('backup:delete', [['backups']])

export const useSuperpowers = () => useQuery({ queryKey: ['superpowers'] as const, queryFn: () => call('superpowers:status') })

// Which CLIs are installed and what each can do. Cached by the main process; a failed probe shows as not installed, never as working.
export const capabilityKey = ['capabilities'] as const
export const useCapabilities = () => useQuery({ queryKey: capabilityKey, queryFn: () => call('capabilities:get'), staleTime: 60_000 })
export function useRefreshCapabilities() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => call('capabilities:refresh'),
    onSuccess: (r) => qc.setQueryData(capabilityKey, r),
  })
}

// A Claude Code tile's state (sub-agents, status line). The tile id is the scratch terminal's id.
export const claudeTileKey = (tileId: number) => ['claudeTile', tileId] as const
export const useClaudeTileState = (tileId: number | null) =>
  useQuery({ queryKey: claudeTileKey(tileId ?? -1), queryFn: () => call('claudeTile:get', tileId!), enabled: tileId != null })

registerLive((b, qc) => [
  b.on('claudeTile:state', (s) => qc.setQueryData(claudeTileKey(s.tileId), s)),
])
