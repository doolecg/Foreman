// A project's Orchestration graph in its own window. The window loads the app with ?graphPopout=<crewId>.
export const graphPopoutQuery = (crewId: number): Record<string, string> => ({ graphPopout: String(crewId) })

// The project id in a pop-out window's URL query (location.search); null when the page is not a graph pop-out.
export function parseGraphPopoutQuery(search: string): number | null {
  const n = Number(new URLSearchParams(search).get('graphPopout'))
  return Number.isInteger(n) && n > 0 ? n : null
}

export const graphPopoutWindowTitle = 'Orchestration - Foreman'

export const isGraphOut = (out: readonly number[] | undefined, crewId: number): boolean => out?.includes(crewId) === true
