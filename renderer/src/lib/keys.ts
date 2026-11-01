// Keybinds are stored as accelerators like "Mod+Shift+P" or "Alt+Mouse4". Mod is Ctrl, or Cmd on macOS.
import { keyNameOf, matchesMouse, mouseButtonOf, mouseLabel, mouseToAccel, releasesAccel } from '@shared/keybinds'

const isMac = () => window.foreman?.platform === 'darwin'

export function eventToAccel(e: KeyboardEvent): string | null {
  const key = keyNameOf(e)
  if (!key) return null
  const mod = isMac() ? e.metaKey : e.ctrlKey
  const parts = [mod && 'Mod', isMac() && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key]
  return parts.filter(Boolean).join('+')
}

export const matches = (e: KeyboardEvent, accel: string) => !!accel && eventToAccel(e) === accel

// Mouse buttons (middle, back, forward) as shortcuts; left and right click are never bound.
export const mouseEventToAccel = (e: MouseEvent) => mouseToAccel(e, isMac())
export const matchesMouseEvent = (e: MouseEvent, accel: string) => matchesMouse(e, accel, isMac())
export const mouseButtonOfAccel = mouseButtonOf
export const keyReleases = (e: KeyboardEvent, accel: string) => releasesAccel(e, accel, isMac())

// Stops the browser's own action (autoscroll, back/forward) for a bound mouse button.
export function swallowBoundMouse(accels: Array<string | undefined>): () => void {
  const buttons = new Set(accels.map((a) => (a ? mouseButtonOf(a) : null)).filter((b): b is number => b != null))
  if (buttons.size === 0) return () => undefined
  const stop = (e: MouseEvent) => {
    if (buttons.has(e.button)) e.preventDefault()
  }
  const types = ['mousedown', 'mouseup', 'auxclick'] as const
  types.forEach((t) => window.addEventListener(t, stop, true))
  return () => types.forEach((t) => window.removeEventListener(t, stop, true))
}

export function formatAccel(accel: string): string {
  if (!accel) return 'Unbound'
  return accel
    .split('+')
    .map((p) => (p === 'Mod' ? (isMac() ? '⌘' : 'Ctrl') : p === 'Alt' && isMac() ? '⌥' : p === 'Shift' && isMac() ? '⇧' : mouseLabel(p)))
    .join(isMac() ? '' : '+')
}
