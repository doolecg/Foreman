// Which files Foreman opens in the project's browser tile by itself. Pure; no Electron, no file system.

// A document the browser tile shows: HTML or Markdown.
export const isDocFile = (path: string): boolean => /\.(?:html?|md)$/i.test(path)

// A new file in one of these folders (or below one) is opened when Claude creates it.
export const DOC_FOLDERS: readonly string[] = ['docs', 'plans', 'specs', 'artifacts', 'design']

const ABSOLUTE = /^(?:[a-z]:)?\//i

// The path relative to the project folder with forward slashes, or null when it lies outside it (or climbs with "..").
// A relative path is taken as relative to the project folder already.
export function relativeInProject(root: string, path: string): string | null {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = path.replace(/\\/g, '/')
  let rel: string
  if (ABSOLUTE.test(p)) {
    const windows = /^[a-z]:/i.test(r)
    const head = p.slice(0, r.length)
    if (!r || p.length <= r.length + 1 || p[r.length] !== '/' || (windows ? head.toLowerCase() !== r.toLowerCase() : head !== r)) return null
    rel = p.slice(r.length + 1)
  } else {
    rel = p
  }
  const parts = rel.split('/').filter((s) => s !== '' && s !== '.')
  if (parts.length === 0 || parts.includes('..')) return null
  return parts.join('/')
}

// The project-relative path of a file Claude just created when it should open by itself: an .html, .htm or .md file in a
// docs, plans, specs, artifacts or design folder, or below one. Plain edits (created = false) never open.
export function autoOpenPath(root: string, path: string, created: boolean): string | null {
  if (!created || !isDocFile(path)) return null
  const rel = relativeInProject(root, path)
  if (!rel) return null
  const dirs = rel.split('/').slice(0, -1)
  return dirs.some((d) => DOC_FOLDERS.includes(d.toLowerCase())) ? rel : null
}
