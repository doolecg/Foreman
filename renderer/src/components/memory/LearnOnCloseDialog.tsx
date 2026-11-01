import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { bridge } from '@/lib/bridge'
import { call } from '@/lib/queries'

interface Ask {
  scratchId: number
  title: string
}

// Shown when a Claude tile closes before the learn step ran for it. Several closes in a row are asked one after the other.
export function LearnOnCloseDialog() {
  const [queue, setQueue] = useState<Ask[]>([])

  useEffect(() => bridge().on('learn:askOnClose', (a) => setQueue((q) => [...q, { scratchId: a.scratchId, title: a.title }])), [])

  const current = queue[0]
  const answer = (learn: boolean) => {
    if (!current) return
    setQueue((q) => q.slice(1))
    void call('learn:answerClose', current.scratchId, learn).catch(() => undefined)
  }

  return (
    <Dialog open={current != null} onOpenChange={(o) => !o && answer(false)}>
      <DialogContent size="sm" data-testid="learn-on-close-dialog">
        <DialogHeader>
          <DialogTitle>Learn from this session?</DialogTitle>
          <DialogDescription>{current ? `"${current.title}" was closed before Foreman learned from it. Learn from it now?` : ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" aria-label="Skip learning from this session" onClick={() => answer(false)}>
            Skip
          </Button>
          <Button aria-label="Learn from this session" onClick={() => answer(true)}>
            Learn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
