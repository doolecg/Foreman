import { memo, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FileText, Folder } from 'lucide-react'
import { buildTree, changedFilesTitle, compactCount, dirIds, initiallyOpen, sumChanges, type FileChange, type TreeNode } from '@shared/chat-changes'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The app opens the project's Git page on Changes when it hears this; `path` is the file whose row was clicked.
export const OPEN_CHANGES_EVENT = 'foreman:open-changes'
export interface OpenChangesDetail {
  path?: string
}
const openChanges = (path?: string) => window.dispatchEvent(new CustomEvent<OpenChangesDetail>(OPEN_CHANGES_EVENT, { detail: { path } }))

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 gap-2 tabular-nums">
      <span className="text-success">+{compactCount(added)}</span>
      <span className="text-destructive">-{compactCount(removed)}</span>
    </span>
  )
}

const row = 'm-press hover:bg-accent flex w-full items-center gap-2 rounded-lg py-1 pr-2 text-left'

// After a finished turn that edited files: the files as a folder tree with +/- line counts and a way to the diff.
export const ChangedFilesCard = memo(function ChangedFilesCard({ files, small }: { files: FileChange[]; small?: boolean }) {
  const tree = useMemo(() => buildTree(files), [files])
  const total = useMemo(() => sumChanges(files), [files])
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen(files.length, tree)))
  const dirs = useMemo(() => dirIds(tree), [tree])
  const allOpen = dirs.length > 0 && dirs.every((d) => open.has(d))
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const nodes = (list: TreeNode[], depth: number): ReactNode =>
    list.map((n) => {
      const pad = { paddingLeft: `${depth * 16 + 8}px` }
      if (n.type === 'file')
        return (
          <li key={n.id}>
            <button type="button" className={row} style={pad} title={n.path} onClick={() => openChanges(n.path)}>
              <span className="size-3.5 shrink-0" aria-hidden />
              <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              <Counts added={n.added} removed={n.removed} />
            </button>
          </li>
        )
      const isOpen = open.has(n.id)
      return (
        <li key={n.id}>
          <button type="button" aria-expanded={isOpen} className={row} style={pad} onClick={() => toggle(n.id)}>
            <ChevronRight className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} aria-hidden />
            <Folder className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            <Counts added={n.added} removed={n.removed} />
          </button>
          {isOpen && <ul>{nodes(n.children, depth + 1)}</ul>}
        </li>
      )
    })

  return (
    <section aria-label="Changed files" className={cn('m-enter m-enter-row surface rounded-xl p-1.5 text-[13px]', small && 'text-xs')} data-chat="changed-files">
      <div className="flex items-center gap-2.5 py-1 pr-1 pl-2">
        <span className="text-foreground font-medium">{changedFilesTitle(files.length)}</span>
        <Counts added={total.added} removed={total.removed} />
        <span className="flex-1" />
        {dirs.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="m-press text-muted-foreground"
            aria-label={allOpen ? 'Collapse all changed files' : 'Expand all changed files'}
            onClick={() => setOpen(new Set(allOpen ? [] : dirs))}
          >
            {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          </Button>
        )}
        <Button type="button" variant="ghost" size="xs" className="m-press" onClick={() => openChanges()}>
          Open diff
        </Button>
      </div>
      <ul className="mt-0.5">{nodes(tree, 0)}</ul>
    </section>
  )
})
