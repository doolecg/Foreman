import { cn } from '@/lib/utils'

export type View = 'thread' | 'board'

const LABEL: Record<View, string> = { thread: 'Thread', board: 'Board' }

// The views of the open project, as pills in the middle of the top bar.
export function TopNav({ views, view, onChange }: { views: View[]; view: View | null; onChange: (v: View) => void }) {
  return (
    <nav aria-label="Views" className="flex items-center gap-0.5">
      {views.map((v) => (
        <button
          key={v}
          type="button"
          aria-current={v === view ? 'page' : undefined}
          onClick={() => onChange(v)}
          className={cn('m-press focus-visible:ring-ring/50 h-7 rounded-full px-4 text-[13px] outline-none focus-visible:ring-[3px]', v === view ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {LABEL[v]}
        </button>
      ))}
    </nav>
  )
}
