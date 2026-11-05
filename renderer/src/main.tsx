import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { BrowserPopoutPage } from './components/browser/BrowserPopout'
import { TilePopoutPage } from './components/terminal/TilePopout'
import { GraphPopoutPage } from './components/mods/agents/GraphSection'
import { TooltipProvider } from './components/ui/tooltip'
import { call } from './lib/queries'
import { parseTilePopoutQuery } from '@shared/tile-popout'
import { parseGraphPopoutQuery } from '@shared/graph-popout'
import './index.css'
import { ThemeApplier, applyStoredTheme } from './lib/theme'

applyStoredTheme()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
})

// A browser pop-out window loads this page with ?browserPopout=<crewId> and shows only that project's browser.
const popoutCrew = Number(new URLSearchParams(location.search).get('browserPopout'))
// A terminal pop-out window loads this page with ?tilePopout=<scratchId> and shows only that tile.
const popoutTile = parseTilePopoutQuery(location.search)
// A graph pop-out window loads this page with ?graphPopout=<crewId> and shows only that project's Orchestration graph.
const popoutGraph = parseGraphPopoutQuery(location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeApplier />
      {popoutCrew ? (
        <TooltipProvider>
          <BrowserPopoutPage crewId={popoutCrew} onPopIn={() => void call('browser:popIn', popoutCrew)} />
        </TooltipProvider>
      ) : popoutTile ? (
        <TooltipProvider>
          <TilePopoutPage req={popoutTile} />
        </TooltipProvider>
      ) : popoutGraph ? (
        <TooltipProvider>
          <GraphPopoutPage crewId={popoutGraph} />
        </TooltipProvider>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
)
