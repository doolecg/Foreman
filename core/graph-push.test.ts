import { describe, expect, it } from 'vitest'
import { createGraphPusher } from './graph-push'

// A hand-driven clock and timer, so the throttle is tested without real waiting.
function harness(intervalMs = 250) {
  let t = 1000
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = []
  const sent: string[] = []
  const pusher = createGraphPusher({
    intervalMs,
    send: (k) => sent.push(k),
    now: () => t,
    setTimer: (fn, ms) => {
      const rec = { at: t + ms, fn, live: true }
      timers.push(rec)
      return rec
    },
    clearTimer: (h) => void ((h as { live: boolean }).live = false),
  })
  const advance = (ms: number) => {
    t += ms
    for (const r of timers) if (r.live && r.at <= t) ((r.live = false), r.fn())
  }
  return { pusher, sent, advance }
}

describe('createGraphPusher', () => {
  it('sends the first change at once', () => {
    const h = harness()
    h.pusher.push('p')
    expect(h.sent).toEqual(['p'])
  })

  it('folds a burst inside the interval into one later send', () => {
    const h = harness()
    h.pusher.push('p')
    for (let i = 0; i < 20; i++) h.pusher.push('p')
    expect(h.sent).toHaveLength(1)
    h.advance(249)
    expect(h.sent).toHaveLength(1)
    h.advance(1)
    expect(h.sent).toHaveLength(2)
  })

  it('never sends more than 4 times a second for one project', () => {
    const h = harness()
    for (let ms = 0; ms < 1000; ms += 10) {
      h.pusher.push('p')
      h.advance(10)
    }
    expect(h.sent.length).toBeLessThanOrEqual(5)
    expect(h.sent.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps projects apart', () => {
    const h = harness()
    h.pusher.push('a')
    h.pusher.push('b')
    expect(h.sent).toEqual(['a', 'b'])
  })

  it('sends nothing after dispose', () => {
    const h = harness()
    h.pusher.push('p')
    h.pusher.push('p')
    h.pusher.dispose()
    h.advance(1000)
    expect(h.sent).toEqual(['p'])
  })

  it('does not re-arm after dispose', () => {
    const h = harness()
    h.pusher.dispose()
    h.pusher.push('p')
    h.advance(1000)
    expect(h.sent).toEqual([])
  })
})
