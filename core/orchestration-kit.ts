import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// The Orchestration kit (plugin/kit: agents, engine-* skills and the model-rules text) installed into a project's own
// .claude folder, so plain `claude` loads it without any Foreman flag. Project files are never overwritten.
const START = '<!-- foreman:orchestration start -->'
const END = '<!-- foreman:orchestration end -->'
const BACKUP = '.foreman-backup'

export interface KitReport {
  // Project-relative paths (forward slashes).
  created: string[]
  // Already identical to the kit.
  skipped: string[]
  // The project has its own different version; it is kept as it is.
  differing: string[]
  // Existing files copied to .claude/.foreman-backup before they were changed.
  backedUp: string[]
  // The CLAUDE.md that got the model-rules section, or null when it already had it.
  rules: string | null
}

// Relative paths (forward slashes) of every file under dir.
function walk(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

const eol = (s: string) => s.replace(/\r\n/g, '\n')

// A backup never replaces an earlier one: when the name is taken, a timestamp (and a counter if needed) is added.
function freeName(dest: string): string {
  if (!existsSync(dest)) return dest
  const stamp = Date.now()
  let n = 0
  let next = `${dest}.${stamp}`
  while (existsSync(next)) next = `${dest}.${stamp}-${++n}`
  return next
}

function backUp(project: string, file: string, report: KitReport): void {
  const rel = relative(project, file).replace(/\\/g, '/')
  const dest = freeName(join(project, '.claude', BACKUP, rel))
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(file, dest)
  report.backedUp.push(rel)
}

// Adds the model-rules section to the project's CLAUDE.md (root one if it exists, else .claude/CLAUDE.md), between markers
// so a later run can refresh it. Anything outside the markers is left alone; the old file is backed up first.
function mergeRules(kitDir: string, project: string, report: KitReport): void {
  const src = join(kitDir, 'CLAUDE.md')
  if (!existsSync(src)) return
  const block = `${START}\n${eol(readFileSync(src, 'utf8')).trim()}\n${END}\n`
  const root = join(project, 'CLAUDE.md')
  const target = existsSync(root) ? root : join(project, '.claude', 'CLAUDE.md')
  const rel = relative(project, target).replace(/\\/g, '/')
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, block)
    report.created.push(rel)
    report.rules = rel
    return
  }
  const cur = readFileSync(target, 'utf8')
  const crlf = cur.includes('\r\n')
  const text = eol(cur)
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  let next: string
  if (a >= 0 && b > a) {
    if (text.slice(a, b + END.length) === block.trim()) {
      report.skipped.push(rel)
      return
    }
    next = text.slice(0, a) + block.trim() + text.slice(b + END.length)
  } else {
    next = `${text.replace(/\s+$/, '')}\n\n${block}`
  }
  backUp(project, target, report)
  // Keep the file's own line endings so the merge does not show as a whole-file change.
  writeFileSync(target, crlf ? next.replace(/\n/g, '\r\n') : next)
  report.rules = rel
}

export function installKit(kitDir: string, folder: string): KitReport {
  const project = resolve(folder)
  // Never create the project root: a moved or deleted folder is the owner's to sort out.
  if (!existsSync(project)) throw new Error(`the project folder ${project} does not exist`)
  const report: KitReport = { created: [], skipped: [], differing: [], backedUp: [], rules: null }
  for (const rel of [...walk(join(kitDir, 'agents'), 'agents'), ...walk(join(kitDir, 'skills'), 'skills'), ...walk(join(kitDir, 'foreman'), 'foreman')]) {
    const src = join(kitDir, rel)
    const dest = join(project, '.claude', rel)
    const shown = `.claude/${rel}`
    if (!existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
      report.created.push(shown)
    } else if (eol(readFileSync(dest, 'utf8')) === eol(readFileSync(src, 'utf8'))) report.skipped.push(shown)
    else report.differing.push(shown)
  }
  mergeRules(kitDir, project, report)
  return report
}

export interface UninstallReport {
  // Project-relative paths (forward slashes) moved to .claude/.foreman-backup, or the CLAUDE.md the rules block was cut from.
  moved: string[]
  // Kit files the project has edited; left where they are.
  kept: string[]
}

// Takes the Orchestration kit back out of the project's .claude so it stops loading. Nothing is deleted: kit files that
// still match the kit move to .claude/.foreman-backup, edited ones stay, and only the marked rules block leaves CLAUDE.md.
export function uninstallKit(kitDir: string, folder: string): UninstallReport {
  const project = resolve(folder)
  const report: UninstallReport = { moved: [], kept: [] }
  if (!existsSync(project)) return report
  for (const rel of [...walk(join(kitDir, 'agents'), 'agents'), ...walk(join(kitDir, 'skills'), 'skills'), ...walk(join(kitDir, 'foreman'), 'foreman')]) {
    const dest = join(project, '.claude', rel)
    if (!existsSync(dest)) continue
    const shown = `.claude/${rel}`
    if (eol(readFileSync(dest, 'utf8')) !== eol(readFileSync(join(kitDir, rel), 'utf8'))) {
      report.kept.push(shown)
      continue
    }
    const to = freeName(join(project, '.claude', BACKUP, shown))
    mkdirSync(dirname(to), { recursive: true })
    renameSync(dest, to)
    report.moved.push(shown)
  }
  for (const target of [join(project, 'CLAUDE.md'), join(project, '.claude', 'CLAUDE.md')]) {
    if (!existsSync(target)) continue
    const cur = readFileSync(target, 'utf8')
    const text = eol(cur)
    const a = text.indexOf(START)
    const b = text.indexOf(END)
    if (a < 0 || b <= a) continue
    const rel = relative(project, target).replace(/\\/g, '/')
    const before = text.slice(0, a).replace(/\s+$/, '')
    const after = text.slice(b + END.length).replace(/^\s+/, '')
    const rest = before && after ? `${before}\n\n${after}` : before || after
    if (!rest.trim()) {
      // The file held only the kit rules: move it whole rather than leave an empty CLAUDE.md.
      const to = freeName(join(project, '.claude', BACKUP, rel))
      mkdirSync(dirname(to), { recursive: true })
      renameSync(target, to)
    } else {
      backUp(project, target, { created: [], skipped: [], differing: [], backedUp: [], rules: null })
      const next = `${rest.replace(/\s+$/, '')}\n`
      writeFileSync(target, cur.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next)
    }
    report.moved.push(rel)
  }
  return report
}
