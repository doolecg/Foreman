import { useQuery } from '@tanstack/react-query'
import { call, registerLive } from './core'

// The Orchestration graph of a project. Main pushes 'graph:state' (throttled), so every window, a pop-out included, shows the same state.
export const graphKey = (crewId: number) => ['orchestrationGraph', crewId] as const
export const useOrchestrationGraph = (crewId: number | null) =>
  useQuery({ queryKey: graphKey(crewId ?? -1), queryFn: () => call('graph:get', crewId!), enabled: crewId !== null })

// The project ids whose graph is in its own window.
const popoutsKey = ['graphPopouts'] as const
export const useGraphPopouts = () => useQuery({ queryKey: popoutsKey, queryFn: () => call('graph:popouts') })

registerLive((b, qc) => [
  b.on('graph:state', (s) => qc.setQueryData(graphKey(s.crewId), s.graph)),
  b.on('graph:popouts', (ids) => qc.setQueryData(popoutsKey, ids)),
])
