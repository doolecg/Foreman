import { runningSubagents } from '@shared/chat-queue'
import { PixelBar } from '@/components/ui/pixel-bar'
import { chipClass } from './StageBox'
import { useChatState } from './useChat'

// Orchestration as a chip at the top of the chat: "Orchestration" with a pixel bar that sweeps while this thread has helpers running.
export function FactoryChip({ scratchId, on }: { scratchId: number | null; on: boolean }) {
  const helpers = runningSubagents(useChatState(scratchId)?.items ?? [])
  if (!on) return null
  const label = helpers > 0 ? `Orchestration: ${helpers} helper${helpers === 1 ? '' : 's'} working` : 'Orchestration: no helpers running'
  return (
    <span data-chat="factory-chip" role="status" aria-label={label} className={chipClass}>
      {helpers > 0 ? `${helpers} helper${helpers === 1 ? '' : 's'}` : 'Orchestration'}
      <span className="w-[72px]">
        <PixelBar sweep={helpers > 0} tone="primary" label={label} />
      </span>
    </span>
  )
}
