import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Catalog, SetupPlan } from './setup-catalog'
import { writeSetup } from './setup-write'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'foreman-setup-'))
  const skillSrc = join(root, 'src-skill')
  mkdirSync(skillSrc)
  writeFileSync(join(skillSrc, 'SKILL.md'), 'skill')
  const project = join(root, 'proj')
  mkdirSync(project)
  const catalog: Catalog = {
    agents: { builder: { needed_when: '', how: 'agent' } },
    mcp: { blender: { needed_when: '', how: 'project-mcp', config: { type: 'stdio' } } },
    skills: {
      taste: { needed_when: '', how: 'project-skill', path: skillSrc },
      carried: { needed_when: '', how: 'project-skill', path: skillSrc, carried_by: 'builder' },
    },
    plugins: { sidebar: { needed_when: '', how: 'plugin', id: 'sidebar@x' } },
    presets: {},
  }
  const plan: SetupPlan = {
    preset: 'other',
    picks: [
      { kind: 'agents', name: 'builder', why: 'preset other' },
      { kind: 'mcp', name: 'blender', why: 'mentions blender' },
      { kind: 'skills', name: 'taste', why: 'mentions ui' },
      { kind: 'skills', name: 'carried', why: 'mentions ui' },
      { kind: 'plugins', name: 'sidebar', why: 'mentions sidebar' },
    ],
  }
  return { project, catalog, plan }
}

describe('writeSetup', () => {
  it('writes the project files and records them in CLAUDE.md', () => {
    const { project, catalog, plan } = fixture()
    const res = writeSetup(project, catalog, plan, '2026-11-01')
    expect(JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8')).mcpServers.blender).toEqual({ type: 'stdio' })
    expect(existsSync(join(project, '.claude', 'skills', 'taste', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(project, '.claude', 'skills', 'carried'))).toBe(false)
    expect(JSON.parse(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).enabledPlugins['sidebar@x']).toBe(true)
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toContain('## Setup')
    expect(res.needsRestart).toBe(true)
  })

  it('keeps existing entries and leaves broken JSON alone', () => {
    const { project, catalog, plan } = fixture()
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { blender: { mine: true }, other: {} } }))
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'settings.json'), '{ not json')
    const res = writeSetup(project, catalog, plan, '2026-11-01')
    expect(JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8')).mcpServers.blender).toEqual({ mine: true })
    expect(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).toBe('{ not json')
    expect(res.skipped.some((s) => s.includes('not valid JSON'))).toBe(true)
  })

  it('appends to an existing Setup section instead of rewriting it', () => {
    const { project, catalog, plan } = fixture()
    writeFileSync(join(project, 'CLAUDE.md'), '# P\n\n## Setup\nold line\n')
    writeSetup(project, catalog, plan, '2026-11-01')
    const text = readFileSync(join(project, 'CLAUDE.md'), 'utf8')
    expect(text).toContain('old line')
    expect(text).toContain('### Added 2026-11-01')
  })
})
