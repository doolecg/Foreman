import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { call, registerLive } from './core'

const HS = ['hindsight'] as const

export const useHindsightStatus = () =>
  useQuery({ queryKey: ['hindsight', 'status'] as const, queryFn: () => call('hindsight:status'), retry: false })

export const useHindsightAdapters = () => useQuery({ queryKey: ['hindsight', 'adapters'] as const, queryFn: () => call('hindsight:adapters'), staleTime: 30_000 })

// Only whether a key is saved comes back, never the key.
export const useHindsightKeys = () => useQuery({ queryKey: ['hindsight', 'keys'] as const, queryFn: () => call('hindsight:keyState') })

export function useHindsightKeyActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: HS })
  return {
    set: useMutation({ mutationFn: (a: { slot: 'shared' | 'remote'; key: string }) => call('hindsight:setKey', a.slot, a.key), onSuccess: done }),
    clear: useMutation({ mutationFn: (slot: 'shared' | 'remote') => call('hindsight:clearKey', slot), onSuccess: done }),
    generate: useMutation({ mutationFn: () => call('hindsight:generateKey'), onSuccess: done }),
  }
}

export const useHindsightTest = () => useMutation({ mutationFn: () => call('hindsight:test') })

export function useHindsightAct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => call('hindsight:act', action),
    onSuccess: () => qc.invalidateQueries({ queryKey: HS }),
  })
}

// The mode, port and keys decide the status, the health badges and the Memory page. A server stopped or started outside
// Foreman is not pushed, so the window gaining focus reads the status again.
registerLive((b, qc) => {
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hindsight', 'status'] })
  window.addEventListener('focus', refresh)
  return [
    () => window.removeEventListener('focus', refresh),
    b.on('hindsight:changed', refresh),
    b.on('settings', () => {
      void qc.invalidateQueries({ queryKey: HS })
      void qc.invalidateQueries({ queryKey: ['health'] })
    }),
  ]
})
