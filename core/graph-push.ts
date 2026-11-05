// Limits how often one project's graph is sent to the windows: the first change goes out at once, later changes inside
// the interval are folded into one send when the interval ends. A burst of hook events therefore costs at most ~4 sends/s.

export interface GraphPusherOptions {
  intervalMs: number
  send: (key: string) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface GraphPusher {
  push(key: string): void
  dispose(): void
}

export function createGraphPusher(o: GraphPusherOptions): GraphPusher {
  const now = o.now ?? Date.now
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let dead = false
  const lastSent = new Map<string, number>()
  const waiting = new Map<string, unknown>()
  const fire = (key: string) => {
    waiting.delete(key)
    lastSent.set(key, now())
    o.send(key)
  }
  return {
    push(key) {
      if (dead) return
      if (waiting.has(key)) return
      const wait = (lastSent.get(key) ?? -Infinity) + o.intervalMs - now()
      if (wait <= 0) fire(key)
      else waiting.set(key, setTimer(() => fire(key), wait))
    },
    dispose() {
      dead = true
      for (const h of waiting.values()) clearTimer(h)
      waiting.clear()
    },
  }
}
