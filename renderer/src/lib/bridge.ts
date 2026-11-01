import type { ForemanBridge } from '@shared/ipc'

declare global {
  interface Window {
    foreman: ForemanBridge
  }
}

export const bridge = (): ForemanBridge => window.foreman
