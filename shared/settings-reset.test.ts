import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resetSettings, sanitizeSettings } from './settings'

describe('settings reset', () => {
  const changed = sanitizeSettings({ ...DEFAULT_SETTINGS, dailyBudgetUsd: 12, fiveHourBudgetUsd: 3 })

  it('puts one section back to its defaults and keeps the others', () => {
    const next = resetSettings(changed, 'dailyBudgetUsd')
    expect(next.dailyBudgetUsd).toBe(DEFAULT_SETTINGS.dailyBudgetUsd)
    expect(next.fiveHourBudgetUsd).toBe(3)
  })

  it('puts every section back when none is named', () => {
    expect(resetSettings(changed)).toEqual(sanitizeSettings(DEFAULT_SETTINGS))
  })

  it('refuses an unknown section', () => {
    expect(() => resetSettings(changed, 'nope')).toThrow(/No settings section named nope/)
  })

  it('silently drops the removed learn, memory and aux keys from a saved file', () => {
    const s = sanitizeSettings({ learn: { mode: 'advanced' }, memory: { topK: 2 }, auxModels: {}, aux: { maxCallsPerDay: 3 } })
    expect(s).not.toHaveProperty('learn')
    expect(s).not.toHaveProperty('memory')
    expect(s).not.toHaveProperty('auxModels')
    expect(s).not.toHaveProperty('aux')
  })
})
