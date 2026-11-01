import { useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { BrowserTile } from './BrowserTile'
import { useBrowserActions, useBrowserState } from './useBrowser'

const WIDTH = 'foreman.browser.width'
const DEFAULT = 480
const MIN = 320
const MAX = 1000

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH))
    return v >= MIN && v <= MAX ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

// The project's browser, open beside the thread on the right while it is open. Drag its left edge to size it.
export function BrowserSide({ crewId }: { crewId: number }) {
  const state = useBrowserState(crewId).data
  const act = useBrowserActions(crewId)
  const aside = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(readWidth)
  if (!state?.open) return null

  const save = (px: number) => {
    try {
      localStorage.setItem(WIDTH, String(px))
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <aside ref={aside} aria-label="Browser" data-testid="browser-side" style={{ width, minWidth: MIN }} className="m-panel surface relative my-1.5 mr-1.5 flex max-w-[70%] shrink-0 flex-col">
      <ResizeHandle
        target={aside}
        axis="x"
        grow={-1}
        min={MIN}
        max={MAX}
        label="Resize browser"
        className="-left-[3px] w-1.5 cursor-ew-resize"
        onResize={setWidth}
        onCommit={save}
        onReset={() => (setWidth(DEFAULT), save(DEFAULT))}
      />
      <div className="flex h-8 shrink-0 items-center gap-1 pr-1.5 pl-3.5">
        <span className="text-primary mr-auto text-[10.5px] font-semibold tracking-[.09em] uppercase">Browser</span>
        {!state.poppedOut && (
          <Button variant="ghost" size="icon-sm" aria-label="Pop browser out" title="Pop out into its own window" onClick={() => act.popOut.mutate()}>
            <ExternalLink />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Close browser" title="Close the browser" onClick={() => act.close.mutate()}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-2xl">
        <BrowserTile crewId={crewId} />
      </div>
    </aside>
  )
}
