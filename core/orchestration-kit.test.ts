import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installKit, uninstallKit } from './orchestration-kit'

let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'fm-kit-'))
  dirs.push(root)
  const kit = join(root, 'kit')
  const project = join(root, 'project')
  mkdirSync(project)
  put(join(kit, 'agents/builder.md'), 'builder')
  put(join(kit, 'skills/engine-recall/SKILL.md'), 'recall')
  put(join(kit, 'foreman/tickets.mjs'), 'tickets')
  put(join(kit, 'CLAUDE.md'), '# Model rules\n\nuse the builder.\n')
  return { kit, project }
}

const all = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(dir, join(rel, e.name)) : [join(rel, e.name).replace(/\\/g, '/')]))

describe('Orchestration kit', () => {
  it('creates the agents, skills and rules in a bare project, with no hooks or settings', () => {
    const { kit, project } = setup()
    const r = installKit(kit, project)
    expect(r.created.sort()).toEqual(['.claude/CLAUDE.md', '.claude/agents/builder.md', '.claude/foreman/tickets.mjs', '.claude/skills/engine-recall/SKILL.md'])
    expect(readFileSync(join(project, '.claude/agents/builder.md'), 'utf8')).toBe('builder')
    expect(readFileSync(join(project, '.claude/foreman/tickets.mjs'), 'utf8')).toBe('tickets')
    expect(readFileSync(join(project, '.claude/CLAUDE.md'), 'utf8')).toContain('use the builder.')
    expect(all(project).some((f) => /settings|hook|live/i.test(f))).toBe(false)
    expect(existsSync(join(project, '.claude/.foreman-backup'))).toBe(false)
  })

  it('does not create a project folder that is missing', () => {
    const { kit, project } = setup()
    const gone = join(project, 'gone')
    expect(() => installKit(kit, gone)).toThrow(/does not exist/)
    expect(existsSync(gone)).toBe(false)
  })

  it('does nothing the second time', () => {
    const { kit, project } = setup()
    installKit(kit, project)
    const r = installKit(kit, project)
    expect(r.created).toEqual([])
    expect(r.backedUp).toEqual([])
    expect(r.skipped).toHaveLength(4)
  })

  it('keeps a differing agent file as it is and reports it', () => {
    const { kit, project } = setup()
    put(join(project, '.claude/agents/builder.md'), 'mine')
    const r = installKit(kit, project)
    expect(readFileSync(join(project, '.claude/agents/builder.md'), 'utf8')).toBe('mine')
    expect(r.differing).toEqual(['.claude/agents/builder.md'])
    expect(r.created).toContain('.claude/skills/engine-recall/SKILL.md')
  })

  it('adds the rules to an existing root CLAUDE.md after backing it up, and leaves the owner text alone', () => {
    const { kit, project } = setup()
    put(join(project, 'CLAUDE.md'), '# Mine\n\nkeep this.\n')
    const r = installKit(kit, project)
    const text = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
    expect(text.startsWith('# Mine\n\nkeep this.\n')).toBe(true)
    expect(text).toContain('use the builder.')
    expect(r.rules).toBe('CLAUDE.md')
    expect(r.backedUp).toEqual(['CLAUDE.md'])
    expect(readFileSync(join(project, '.claude/.foreman-backup/CLAUDE.md'), 'utf8')).toBe('# Mine\n\nkeep this.\n')
    expect(existsSync(join(project, '.claude/CLAUDE.md'))).toBe(false)
  })

  it('keeps CRLF line endings when it merges into a CRLF CLAUDE.md', () => {
    const { kit, project } = setup()
    put(join(project, 'CLAUDE.md'), '# Mine\r\n\r\nkeep this.\r\n')
    installKit(kit, project)
    const text = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
    expect(text.startsWith('# Mine\r\n\r\nkeep this.\r\n')).toBe(true)
    expect(text).toContain('use the builder.')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    installKit(kit, project)
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toBe(text)
  })

  it('reports clean relative paths when the project folder ends in a slash', () => {
    const { kit, project } = setup()
    put(join(project, 'CLAUDE.md'), 'top\n')
    const r = installKit(kit, project + sep)
    expect(r.rules).toBe('CLAUDE.md')
    expect(r.backedUp).toEqual(['CLAUDE.md'])
    expect(readFileSync(join(project, '.claude/.foreman-backup/CLAUDE.md'), 'utf8')).toBe('top\n')
  })

  it('refreshes only its own marked block when the kit text changes', () => {
    const { kit, project } = setup()
    put(join(project, 'CLAUDE.md'), 'top\n')
    installKit(kit, project)
    put(join(kit, 'CLAUDE.md'), '# Model rules\n\nnew text.\n')
    installKit(kit, project)
    const text = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
    expect(text).toContain('new text.')
    expect(text).not.toContain('use the builder.')
    expect(text.startsWith('top\n')).toBe(true)
    expect(text.match(/foreman:orchestration start/g)).toHaveLength(1)
  })

  it('ships the real kit without hooks, settings or the live server', () => {
    const kit = join(__dirname, '..', 'plugin', 'kit')
    const files = all(kit)
    expect(files).toEqual(expect.arrayContaining(['agents/builder.md', 'agents/recall.md', 'agents/reviewer.md', 'agents/council-ui.md', 'agents/council-code.md', 'agents/council-run.md', 'foreman/tickets.mjs', 'CLAUDE.md']))
    expect(files.filter((f) => f.startsWith('skills/engine-'))).toHaveLength(7)
    expect(files.some((f) => /settings|hook|live/i.test(f))).toBe(false)
  })

  describe('uninstallKit', () => {
    it('moves unchanged kit files to the backup folder and removes the rules file it created', () => {
      const { kit, project } = setup()
      installKit(kit, project)
      const r = uninstallKit(kit, project)
      expect(r.moved.sort()).toEqual(['.claude/CLAUDE.md', '.claude/agents/builder.md', '.claude/foreman/tickets.mjs', '.claude/skills/engine-recall/SKILL.md'])
      expect(r.kept).toEqual([])
      expect(existsSync(join(project, '.claude/agents/builder.md'))).toBe(false)
      expect(existsSync(join(project, '.claude/foreman/tickets.mjs'))).toBe(false)
      expect(readFileSync(join(project, '.claude/.foreman-backup/.claude/foreman/tickets.mjs'), 'utf8')).toBe('tickets')
      expect(existsSync(join(project, '.claude/skills/engine-recall/SKILL.md'))).toBe(false)
      expect(existsSync(join(project, '.claude/CLAUDE.md'))).toBe(false)
      expect(readFileSync(join(project, '.claude/.foreman-backup/.claude/agents/builder.md'), 'utf8')).toBe('builder')
      expect(readFileSync(join(project, '.claude/.foreman-backup/.claude/skills/engine-recall/SKILL.md'), 'utf8')).toBe('recall')
    })

    it('leaves an edited kit file where it is and reports it', () => {
      const { kit, project } = setup()
      installKit(kit, project)
      put(join(project, '.claude/agents/builder.md'), 'mine')
      const r = uninstallKit(kit, project)
      expect(r.kept).toEqual(['.claude/agents/builder.md'])
      expect(readFileSync(join(project, '.claude/agents/builder.md'), 'utf8')).toBe('mine')
      expect(r.moved).not.toContain('.claude/agents/builder.md')
    })

    it('cuts only the marked block from a CLAUDE.md, after backing it up', () => {
      const { kit, project } = setup()
      put(join(project, 'CLAUDE.md'), '# Mine\n\nkeep this.\n')
      installKit(kit, project)
      const withBlock = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
      const r = uninstallKit(kit, project)
      const text = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
      expect(text).toBe('# Mine\n\nkeep this.\n')
      expect(r.moved).toContain('CLAUDE.md')
      const dir = join(project, '.claude/.foreman-backup')
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# Mine\n\nkeep this.\n')
      expect(readdirSync(dir).some((n) => n.startsWith('CLAUDE.md.') && readFileSync(join(dir, n), 'utf8') === withBlock)).toBe(true)
    })

    it('keeps CRLF line endings and the text after the block', () => {
      const { kit, project } = setup()
      put(join(project, 'CLAUDE.md'), '# Mine\r\n\r\nkeep this.\r\n')
      installKit(kit, project)
      const added = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
      put(join(project, 'CLAUDE.md'), added + '\r\nafter.\r\n')
      uninstallKit(kit, project)
      expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toBe('# Mine\r\n\r\nkeep this.\r\n\r\nafter.\r\n')
    })

    it('does nothing the second time', () => {
      const { kit, project } = setup()
      put(join(project, 'CLAUDE.md'), 'top\n')
      installKit(kit, project)
      uninstallKit(kit, project)
      const r = uninstallKit(kit, project)
      expect(r).toEqual({ moved: [], kept: [] })
      expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toBe('top\n')
    })

    it('lets the kit be installed again afterwards', () => {
      const { kit, project } = setup()
      installKit(kit, project)
      uninstallKit(kit, project)
      const r = installKit(kit, project)
      expect(r.created.sort()).toEqual(['.claude/CLAUDE.md', '.claude/agents/builder.md', '.claude/foreman/tickets.mjs', '.claude/skills/engine-recall/SKILL.md'])
      expect(readFileSync(join(project, '.claude/agents/builder.md'), 'utf8')).toBe('builder')
    })

    it('never overwrites an earlier backup', () => {
      const { kit, project } = setup()
      put(join(project, 'CLAUDE.md'), 'top\n')
      installKit(kit, project)
      uninstallKit(kit, project)
      put(join(project, 'CLAUDE.md'), 'top edited\n')
      installKit(kit, project)
      uninstallKit(kit, project)
      const dir = join(project, '.claude/.foreman-backup')
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('top\n')
      const names = readdirSync(dir).filter((n) => n.startsWith('CLAUDE.md'))
      expect(names.length).toBeGreaterThan(1)
      expect(names.some((n) => n !== 'CLAUDE.md' && readFileSync(join(dir, n), 'utf8').includes('top edited'))).toBe(true)
      const agents = readdirSync(join(dir, '.claude/agents'))
      expect(agents).toHaveLength(2)
      installKit(kit, project)
      uninstallKit(kit, project)
      expect(readdirSync(join(dir, '.claude/agents'))).toHaveLength(3)
    })
  })
})
