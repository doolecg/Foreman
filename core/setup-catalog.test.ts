import { describe, expect, it } from 'vitest'
import { pickPreset, planSetup, type Catalog } from './setup-catalog'

const catalog: Catalog = {
  agents: {
    builder: { needed_when: 'edits', how: 'agent', keywords: ['build', 'fix'] },
    runner: { needed_when: 'tests', how: 'agent', keywords: ['test'] },
    designer: { needed_when: 'ui', how: 'agent', keywords: ['ui'] },
  },
  mcp: { blender: { needed_when: '3d', how: 'project-mcp', keywords: ['blender', '3d'], config: { type: 'stdio' } } },
  skills: {},
  plugins: {},
  presets: { web: ['designer', 'builder'], godot: ['blender', 'builder'], other: ['builder', 'runner'] },
}

describe('setup catalog matcher', () => {
  it('picks a preset from words in the prompt', () => {
    expect(pickPreset(catalog, 'A website for a bakery')).toBe('web')
    expect(pickPreset(catalog, 'A small game in Godot')).toBe('godot')
    expect(pickPreset(catalog, 'Tidy my notes')).toBe('other')
  })

  it('lets a chosen preset beat the guess', () => {
    expect(planSetup(catalog, 'A website for a bakery', 'godot').preset).toBe('godot')
    expect(planSetup(catalog, 'A website for a bakery', 'nope').preset).toBe('web')
  })

  it('does not match a word inside another word', () => {
    expect(pickPreset(catalog, 'the opposite of simple')).toBe('other')
  })

  it('adds preset members and keyword hits, once each', () => {
    const plan = planSetup(catalog, 'Build a 3D game in Godot and test it')
    const names = plan.picks.map((p) => `${p.kind}:${p.name}`).sort()
    expect(plan.preset).toBe('godot')
    expect(names).toEqual(['agents:builder', 'agents:runner', 'mcp:blender'])
    expect(plan.picks.find((p) => p.name === 'blender')!.why).toContain('preset godot')
  })
})
