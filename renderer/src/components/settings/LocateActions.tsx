import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { decodeIpcError } from '@shared/ipc'
import type { InstallStatusItem } from '@shared/install'
import { Button } from '@/components/ui/button'
import { useToolPath } from '@/lib/queries'

// What to do about a program Foreman cannot find: look in the places its installer uses, and if that finds nothing, pick the
// file yourself. A program Foreman was pointed at can go back to PATH.
export function LocateActions({ item }: { item: InstallStatusItem }) {
  const tool = useToolPath()
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const id = item.id
  const run = (op: 'find' | 'locate' | 'forget') => {
    setNote(null)
    tool.mutate(
      { op, id },
      {
        onSuccess: (r) => {
          if (op === 'find') setNote(r?.state === 'installed' ? { text: `Found it: ${r.path ?? ''}`, error: false } : { text: 'Not in the default places. Use Locate to pick the program yourself.', error: true })
        },
        onError: (e) => setNote({ text: decodeIpcError(e).message, error: true }),
      },
    )
  }
  const busy = tool.isPending
  const missing = item.state !== 'installed'
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {missing && (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => run('find')} aria-label={`Look for ${id} in the default places`}>
          {busy && tool.variables?.op === 'find' && <Loader2 className="animate-spin" />}
          Look in default places
        </Button>
      )}
      {missing && (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => run('locate')} aria-label={`Locate ${id}`}>
          Locate…
        </Button>
      )}
      {!missing && item.custom && (
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => run('forget')} aria-label={`Use ${id} from PATH again`}>
          Use PATH again
        </Button>
      )}
      {note && (
        <span role={note.error ? 'alert' : 'status'} className={note.error ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
          {note.text}
        </span>
      )}
    </div>
  )
}
