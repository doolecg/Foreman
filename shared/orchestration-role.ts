// Which graph node a sub-agent name belongs to. Shared by core/orchestration-graph.ts (state) and the graph view (freelancers).

export type Role = 'opus' | 'builder' | 'recall' | 'ui' | 'code' | 'run'

// Same mapping as the Model Engine's who(): council-ui/code/run, reviewer (the Opus gate), recall, builder.
// null means the agent has no node in the graph.
export function roleOf(agentType: string | undefined | null): Role | null {
  const a = agentType ?? ''
  const council = a.match(/council[-_ ]?(ui|code|run)/i)
  if (council?.[1]) return council[1].toLowerCase() as Role
  return /reviewer/i.test(a) ? 'opus' : /recall/i.test(a) ? 'recall' : /builder/i.test(a) ? 'builder' : null
}
