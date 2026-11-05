import { describe, expect, it } from 'vitest'
import { graphPopoutQuery, isGraphOut, parseGraphPopoutQuery } from './graph-popout'

describe('graph pop-out query', () => {
  it('round-trips a project id through the URL query', () => {
    const search = `?${new URLSearchParams(graphPopoutQuery(12)).toString()}`
    expect(parseGraphPopoutQuery(search)).toBe(12)
  })

  it('refuses anything that is not a whole positive id', () => {
    for (const bad of ['', '?graphPopout=', '?graphPopout=0', '?graphPopout=-3', '?graphPopout=1.5', '?graphPopout=abc', '?browserPopout=4']) expect(parseGraphPopoutQuery(bad)).toBeNull()
  })

  it('knows which projects are out', () => {
    expect(isGraphOut([3, 5], 5)).toBe(true)
    expect(isGraphOut([3, 5], 4)).toBe(false)
    expect(isGraphOut(undefined, 4)).toBe(false)
  })
})
