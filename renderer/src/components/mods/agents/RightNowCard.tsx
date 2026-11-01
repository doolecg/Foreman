import { useMemo, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { ChatItem } from '@shared/claude-chat'
import { decodeIpcError } from '@shared/ipc'
import { isDocFile } from '@shared/docs'
import { cn } from '@/lib/utils'
import { useChatState } from '@/components/chat/useChat'
import { call, useGitInfo, useRepoStatus } from '@/lib/queries'
import { PanelRow, SECTION } from '../PanelRow'
import { ArtifactsList } from './ArtifactsList'
import { legendFiles,rightNowHeadline, touchedFiles, type TouchedFile } from './rightNow'

// The dot colours of the legend and the file list: purple read, orange edited, yellow not committed in git.
const READ_DOT = 'bg-chart-4'
const EDIT_DOT = 'bg-chart-6'
const UNCOMMITTED_DOT = 'bg-warning'

// An .html or .md file opens in the project's browser tile when clicked; other files are plain rows.
function FileRow({ file, crewId }: { file: TouchedFile; crewId: number | null }) {
  const [error, setError] = useState<string | null>(null)
  const openable = crewId !== null && isDocFile(file.path)
  const open = () => {
    if (crewId === null) return
    setError(null)
    call('docs:open', crewId, file.path).catch((e: unknown) => setError(decodeIpcError(e).message))
  }
  const name = <span className="min-w-0 truncate font-mono text-[11px]">{file.name}</span>
  return (
    <li className="min-w-0 text-xs" title={file.path}>
      <div className="flex min-w-0 items-center gap-2">
        <i aria-hidden className={cn('size-[7px] shrink-0 rounded-full', file.kind === 'edited' ? EDIT_DOT : READ_DOT)} />
        {file.uncommitted && <i role="img" aria-label="Not committed" className={cn('size-[7px] shrink-0 rounded-full', UNCOMMITTED_DOT)} />}
        {openable ? (
          <button type="button" aria-label={`Open ${file.name} in the browser`} onClick={open} className="hover:text-primary focus-visible:ring-ring flex min-w-0 cursor-pointer items-center rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2">
            {name}
          </button>
        ) : (
          name
        )}
      </div>
      {error && (
        <div role="alert" className="text-destructive mt-0.5 pl-[15px] text-[11px]">
          {error}
        </div>
      )}
    </li>
  )
}

// The "Right now" card at the top of the Agents panel. Terminal tiles show only the branch: their conversation is not in
// the chat stream, so the headline and the file list are left out.
export function RightNowCard({ tileId, crewId, chat }: { tileId: number; crewId: number | null; chat: boolean }) {
  const state = useChatState(chat ? tileId : null)
  const git = useGitInfo(crewId).data
  const status = useRepoStatus(git ? crewId : null).data
  const gitPaths = useMemo(() => (status?.files ?? []).map((f) => f.path), [status?.files])
  const items: ChatItem[] = state?.items ?? []
  const rn = useMemo(() => (state ? rightNowHeadline(items, state.turn) : null), [state, items])
  const files = useMemo(() => touchedFiles(items, gitPaths), [items, gitPaths])
  const legend = legendFiles(files)
  const showHeadline = chat && !!rn
  if (!showHeadline && !git) return null
  const changes = git?.changes ?? 0
  return (
    <section aria-label="Right now" className="shrink-0">
      {chat && rn && (
        <div className={SECTION}>
          <PanelRow
            className="py-2"
            icon={
              <span aria-hidden className="text-primary text-[17px] leading-none">
                ✳
              </span>
            }
            label={rn.headline}
            sub={
              <>
                {rn.subline}
                {rn.diff && (
                  <>
                    {' '}
                    <span className="text-success font-medium">+{rn.diff.added}</span> <span className="text-destructive font-medium">−{rn.diff.removed}</span>
                  </>
                )}
              </>
            }
          />
        </div>
      )}
      {git && (
        <div className={SECTION}>
          <PanelRow
            icon={<GitBranch aria-hidden className="text-info size-4" />}
            label={<span className="font-mono">{git.branch}</span>}
            trailing={
              changes > 0 ? (
                <span className="text-warning shrink-0 text-xs font-medium">{changes} changed</span>
              ) : (
                <span className="text-muted-foreground shrink-0 text-xs">clean, nothing changed</span>
              )
            }
          />
        </div>
      )}
      {chat && rn && (
        <div className={SECTION}>
          <ul className="text-muted-foreground flex flex-wrap gap-x-3.5 gap-y-1 px-1 py-1.5 text-[11px]" aria-label="Colour key">
            <li className="flex items-center gap-1.5">
              <i aria-hidden className={cn('size-[7px] rounded-full', READ_DOT)} />
              Claude read
            </li>
            <li className="flex items-center gap-1.5">
              <i aria-hidden className={cn('size-[7px] rounded-full', EDIT_DOT)} />
              Claude edited
            </li>
            <li className="flex items-center gap-1.5">
              <i aria-hidden className={cn('size-[7px] rounded-full', UNCOMMITTED_DOT)} />
              Not committed
            </li>
          </ul>
          {legend.shown.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-2 px-1 py-1.5" aria-label="Files this session touched">
              {legend.shown.map((f) => (
                <FileRow key={f.path} file={f} crewId={crewId} />
              ))}
              {legend.more > 0 && <li className="text-muted-foreground text-[11px]">+{legend.more} more</li>}
            </ul>
          )}
        </div>
      )}
      {chat && rn && <ArtifactsList items={items} crewId={crewId} />}
    </section>
  )
}
