import { useState } from 'react'
import { RECALL_MODES, type RecallMode } from '@shared/aux-settings'
import { decodeIpcError } from '@shared/ipc'
import type { Lesson } from '@shared/learn'
import type { ResetResult } from '@shared/ops'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { KIND_LABEL } from '@/components/memory/ui'
import { toast } from '@/lib/toast'
import { useCrews, useLessons, useMemoryDelete, useMemoryEdit, useMemoryExport, useMemoryReset, useSaveSettings, useSettings } from '@/lib/queries'
import { ConfirmDialog, NumberField, Row } from '../parts'
import { CodegraphSection } from './CodegraphSection'
import { HindsightSection } from './HindsightSection'
import { MemoryToolsWarning } from '../MemoryToolsWarning'

const RECALL_LABEL: Record<RecallMode, string> = { off: 'Off', 'session-start': 'Session start' }
const RECALL_HINT: Record<RecallMode, string> = {
  off: 'Nothing is recalled.',
  'session-start': 'Relevant memory is added when a session starts.',
}

const fail = (e: unknown) => toast(decodeIpcError(e).message, true)

function LessonRow({ lesson, crewName }: { lesson: Lesson; crewName: string }) {
  const edit = useMemoryEdit()
  const del = useMemoryDelete()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(lesson.text)
  const [confirm, setConfirm] = useState(false)

  return (
    <li className="space-y-2 py-3">
      {editing ? (
        <>
          <Textarea aria-label="Lesson text" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => (setEditing(false), setDraft(lesson.text))}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={edit.isPending || !draft.trim() || draft === lesson.text}
              onClick={() => edit.mutate([lesson.id, { text: draft.trim() }], { onSuccess: () => setEditing(false), onError: fail })}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">{lesson.text}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{KIND_LABEL[lesson.kind]}</Badge>
              <span className="text-muted-foreground">
                {crewName} · {lesson.status}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button variant="outline" size="sm" onClick={() => (setDraft(lesson.text), setEditing(true))}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title="Delete this lesson?"
        confirmLabel="Delete"
        busy={del.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => del.mutate([lesson.id], { onSuccess: () => setConfirm(false), onError: fail })}
      >
        <p>{lesson.text}</p>
      </ConfirmDialog>
    </li>
  )
}

export function MemorySection() {
  const settings = useSettings()
  const save = useSaveSettings()
  const crews = useCrews()
  const lessons = useLessons({})
  const exp = useMemoryExport()
  const reset = useMemoryReset()
  const [scope, setScope] = useState<string>('soul')
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<ResetResult | null>(null)
  const s = settings.data
  if (!s) return null
  const m = s.memory
  const crewList = crews.data ?? []
  const crewName = (id: number) => crewList.find((c) => c.id === id)?.name ?? `project ${id}`
  const list = (lessons.data ?? []).filter((l) => l.status !== 'deleted')
  const setMem = (patch: Partial<typeof m>) => save.mutate({ memory: patch }, { onError: fail })

  const doExport = () =>
    exp.mutate([], {
      onError: fail,
      onSuccess: (r) => {
        const url = URL.createObjectURL(new Blob([r.text], { type: 'text/plain' }))
        const a = document.createElement('a')
        a.href = url
        a.download = r.filename
        a.click()
        URL.revokeObjectURL(url)
      },
    })

  const scopeLabel = scope === 'soul' ? 'the Soul Bank' : scope === 'all' ? 'the Soul Bank and every project bank' : `the memory of ${crewName(Number(scope))}`
  const doReset = () =>
    reset.mutate(
      [scope === 'soul' || scope === 'all' ? { scope, confirm: true } : { scope: 'project', crewId: Number(scope), confirm: true }],
      {
        onError: fail,
        onSuccess: (r) => {
          setResult(r)
          setConfirm(false)
        },
      },
    )

  return (
    <>
      <MemoryToolsWarning />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tools</CardTitle>
          <CardDescription>Both are off until you switch them on. When on and installed, every Claude session Foreman starts uses them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div id="settings-hindsight" className="scroll-mt-6 space-y-3">
            <Row label="Use Hindsight" info="Turns on Hindsight, a memory server that stores lessons so later Claude sessions can recall them. When on and installed, Foreman starts the local server with the app and gives each session access to it. It is off by default." hint="Lessons are kept in Hindsight and recalled when a session starts. Starts the local server with the app." htmlFor="mem-use-hindsight">
              <Switch id="mem-use-hindsight" checked={s.learn.hindsight} onCheckedChange={(v) => save.mutate({ learn: { hindsight: v } }, { onError: fail })} />
            </Row>
            <HindsightSection />
          </div>
          <div id="settings-codegraph" className="scroll-mt-6 space-y-3 border-t pt-6">
            <Row label="Use CodeGraph" info="Turns on CodeGraph, which builds a searchable index of your project's files and functions. When on and installed, each Claude session can look things up in it instead of reading many files, which saves time and tokens. It is off by default." hint="Adds the CodeGraph MCP server to each session." htmlFor="mem-use-codegraph">
              <Switch id="mem-use-codegraph" checked={s.learn.codegraph} onCheckedChange={(v) => save.mutate({ learn: { codegraph: v } }, { onError: fail })} />
            </Row>
            <CodegraphSection />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lessons</CardTitle>
          <CardDescription>Edit or delete what was learned. {list.length} {list.length === 1 ? 'lesson' : 'lessons'}.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-muted-foreground py-3 text-xs">{lessons.isPending ? 'Loading…' : 'No lessons yet.'}</p>
          ) : (
            <ul className="divide-y max-h-96 overflow-auto" aria-label="Lessons">
              {list.map((l) => (
                <LessonRow key={l.id} lesson={l} crewName={crewName(l.crewId)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <details className="group">
          <summary className="cursor-pointer px-6 text-base font-semibold select-none">Advanced recall</summary>
          <CardContent className="divide-y pt-4">
          <Row label="Recall mode" info="Chooses whether saved lessons are added to a session. Session start adds the ones that match the task when a session begins. Off adds nothing, so Claude starts without your past lessons. The default is Session start." hint={RECALL_HINT[m.recallMode]} htmlFor="mem-recall">
            <Select value={m.recallMode} onValueChange={(v) => setMem({ recallMode: v as RecallMode })}>
              <SelectTrigger id="mem-recall" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECALL_MODES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {RECALL_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Entries per recall" info="The most lessons added to a session per recall, from 1 to 50. More gives Claude more background but also more to read, and it must still fit the token limit below. The default is 5." hint="1 to 50." htmlFor="mem-topk">
            <NumberField id="mem-topk" value={m.topK} min={1} max={50} onCommit={(n) => setMem({ topK: n })} />
          </Row>
          <Row label="Token limit" info="Caps the total size of recalled lessons, counted in tokens (small chunks of words), from 100 to 20000. Lessons that do not fit are left out. Lower saves space in the session. The default is 1500." hint="100 to 20000 tokens per recall." htmlFor="mem-tokens">
            <NumberField id="mem-tokens" value={m.maxTokens} min={100} max={20000} onCommit={(n) => setMem({ maxTokens: n })} />
          </Row>
          <Row label="Include the Soul Bank" info="When on, recall also searches the Soul Bank, which holds facts about you and your preferences that are shared across all projects, alongside the current project's lessons. Off recalls project lessons only. It is on by default." hint="Facts about you, shared across projects." htmlFor="mem-soul">
            <Switch id="mem-soul" checked={m.includeSoul} onCheckedChange={(v) => setMem({ includeSoul: v })} />
          </Row>
          </CardContent>
        </details>
      </Card>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
          <CardDescription>Keep a copy of the memory, or wipe it.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Export" hint="Saves every lesson as a text file.">
            <Button variant="outline" size="sm" disabled={exp.isPending} onClick={doExport}>
              {exp.isPending ? 'Exporting…' : 'Export'}
            </Button>
          </Row>
          <Row label="Reset" hint="Deletes the lessons and the Hindsight bank. This cannot be undone.">
            <div className="flex items-center gap-2">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger aria-label="Reset scope" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="soul">Soul Bank</SelectItem>
                  {crewList.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      Project: {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="all">Everything</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="destructive" size="sm" onClick={() => (setResult(null), setConfirm(true))}>
                Reset
              </Button>
            </div>
          </Row>
          {result && (
            <ul className="space-y-1 py-3 text-xs" aria-label="Reset result">
              {result.steps.map((st, i) => (
                <li key={i} className={st.ok ? 'text-muted-foreground' : 'text-destructive'}>
                  {st.target}: {st.ok ? 'done' : st.error}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog open={confirm} title="Reset memory?" confirmLabel="Reset" busy={reset.isPending} onClose={() => setConfirm(false)} onConfirm={doReset}>
        <p>This permanently deletes {scopeLabel}: its lessons and its Hindsight entries.</p>
      </ConfirmDialog>
    </>
  )
}
