import { useState } from 'react'
import { useActiveClaudeTile } from '@/components/terminal/activeClaudeTile'
import { LEARN_STORES, learnOutcomeText, type LearnChange, type LearnCli, type LearnOnLimit, type LearnStore } from '@shared/learn'
import type { RecallMode } from '@shared/aux-settings'
import { decodeIpcError } from '@shared/ipc'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { STORE_LABEL, errorText } from '@/components/memory/ui'
import { Button } from '@/components/ui/button'
import { ModelEffortSelect } from '@/components/settings/ModelEffortSelect'
import { useClearRecords, useCrews, useLearnAi, useLearnRecords, useLessons, useLocalKey, useLocalModels, useMemoryDiagnostics, useMutate, useRollbackChange, useSaveSettings, useSetLocalKey, useSettings, useTestLearnAi } from '@/lib/queries'
import { useMoney } from '@/lib/useMoney'
import { CommitInput, ConfirmDialog, NumberField, Row } from '../parts'
import { MemoryToolsWarning } from '../MemoryToolsWarning'

const STORE_HINT: Record<LearnStore, string> = {
  hindsight: "Writes each lesson to the project's Hindsight memory bank.",
  codegraph: "Keeps notes tagged to files and symbols, next to CodeGraph results.",
  memory: "Writes each lesson as a file in the project's personal memory folder.",
}

const STORE_INFO: Record<LearnStore, string> = {
  hindsight: 'Saves lessons to the Hindsight memory server, so any session on this project can recall them.',
  codegraph: 'Saves lessons as notes tied to files and functions, so they show up next to code results.',
  memory: "Saves lessons as files in the project's memory folder, which Claude reads at the start of a session.",
}

const RECALL_LABEL: Record<RecallMode, string> = { off: 'Off', 'session-start': 'Session start' }

type WhenToLearn = 'off' | 'finished'
const WHEN_HINT: Record<WhenToLearn, string> = {
  off: 'Nothing is learned, and lessons stay out of briefs.',
  finished: 'A cheap review step reads each Claude Code session when it ends and keeps the lessons worth keeping.',
}

const fail = (e: unknown) => toast(decodeIpcError(e).message, true)

function RecordRow({ change }: { change: LearnChange }) {
  const rollback = useRollbackChange()
  const { money } = useMoney()
  return (
    <li className="space-y-1 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm">{change.proposal}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{change.kind}</Badge>
            <Badge variant="outline">{change.status}</Badge>
            <span>{new Date(change.at).toLocaleString()}</span>
            {change.cli && (
              <span>
                {change.cli}
                {change.model ? ` ${change.model}` : ''}
              </span>
            )}
            <span className="tabular-nums">{money(change.usd, true)}</span>
          </div>
        </div>
        {change.status === 'applied' && (
          <Button variant="outline" size="sm" disabled={rollback.isPending} onClick={() => rollback.mutate([change.id], { onError: fail })}>
            Roll back
          </Button>
        )}
      </div>
      {(change.previous || change.next) && change.previous.length + change.next.length < 600 && (
        <div className="text-muted-foreground space-y-0.5 font-mono text-[11px] whitespace-pre-wrap">
          {change.previous && <p>Before: {change.previous}</p>}
          {change.next && <p>After: {change.next}</p>}
        </div>
      )}
    </li>
  )
}

function RecordsCard() {
  const records = useLearnRecords()
  const clear = useClearRecords()
  const [confirm, setConfirm] = useState(false)
  const list = records.data ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Learning records</CardTitle>
        <CardDescription>Every change the learn step proposed or made. Roll back an applied change to restore the text before it.</CardDescription>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="text-muted-foreground py-3 text-xs">{records.isPending ? 'Loading…' : 'No records yet.'}</p>
        ) : (
          <>
            <ul className="max-h-96 divide-y overflow-auto" aria-label="Learning records">
              {list.map((c) => (
                <RecordRow key={c.id} change={c} />
              ))}
            </ul>
            <div className="flex justify-end pt-3">
              <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
                Clear records
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm}
        title="Clear learning records?"
        confirmLabel="Clear"
        busy={clear.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => clear.mutate([], { onSuccess: () => setConfirm(false), onError: fail })}
      >
        <p>Deletes all {list.length} records. Applied changes stay, but can no longer be rolled back.</p>
      </ConfirmDialog>
    </Card>
  )
}

function StatusCard() {
  const settings = useSettings()
  const diag = useMemoryDiagnostics()
  const crews = useCrews()
  const lessons = useLessons({})
  const { money } = useMoney()
  const d = diag.data
  const on = settings.data?.learn.enabled ?? false
  const start = new Date().setHours(0, 0, 0, 0)
  const today = (lessons.data ?? []).filter((x) => x.status !== 'deleted' && x.createdAt >= start).length
  const run = d?.lastRun ?? null
  const project = run ? ((crews.data ?? []).find((c) => c.id === run.crewId)?.name ?? `project ${run.crewId}`) : ''
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What learning did</CardTitle>
        <CardDescription>Whether learning is on, what the last run kept and what it cost today.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label="Learning">
          <span className="text-xs">{on ? 'On' : 'Off'}</span>
        </Row>
        {d && (
          <>
            <Row label="Last learn run" hint={run?.error || undefined}>
              <span className="text-muted-foreground text-xs">
                {run
                  ? `${new Date(run.at).toLocaleString()} · ${project} · ${run.extracted} extracted, ${run.written} written, ${run.merged} merged, ${run.queued} queued${run.cli ? ` · ${run.cli}${run.model ? ` ${run.model}` : ''}` : ''}`
                  : 'None yet'}
              </span>
            </Row>
            <Row label="Lessons added today">
              <span className="text-xs tabular-nums">{today}</span>
            </Row>
            <Row label="Spend today" hint={d.spend.blocked ?? undefined}>
              <span className="text-xs tabular-nums">
                {d.spend.total.calls} calls · {d.spend.total.tokens.toLocaleString()} tokens · {money(d.spend.total.usd, true)}
                {d.spend.label ? ` · ${d.spend.label}` : ''}
              </span>
            </Row>
            <Row label="Recall in force">
              <span className="text-xs">
                {RECALL_LABEL[d.recall.recallMode]} · top {d.recall.topK} · {d.recall.maxTokens} tokens · Soul {d.recall.includeSoul ? 'included' : 'excluded'}
              </span>
            </Row>
            {d.spend.lastError && (
              <p role="alert" className="text-destructive py-3 text-xs">
                Last error: {d.spend.lastError}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function LearningSection() {
  const settings = useSettings()
  const { symbol, toField, fromField } = useMoney()
  const save = useSaveSettings()
  const ai = useLearnAi()
  const test = useTestLearnAi()
  const localKey = useLocalKey()
  const setKey = useSetLocalKey()
  const [keyDraft, setKeyDraft] = useState('')
  const activeTile = useActiveClaudeTile()
  const runNow = useMutate('learn:runNow', [['learn']])
  const s = settings.data
  const local = s?.learn.cli === 'local'
  const localModels = useLocalModels(s?.learn.localUrl ?? '', local)
  if (!s) return null
  const l = s.learn
  const result = test.data
  const picked = ai.data
  // Run now needs learning on and a Claude Code tile to learn from; the reason is shown where the button is.
  const runReason = !l.enabled ? 'Turn learning on first.' : activeTile == null ? 'Open a Claude Code terminal: the learn step reads its session.' : null
  const when: WhenToLearn = l.enabled ? 'finished' : 'off'

  return (
    <>
      <MemoryToolsWarning />
      <StatusCard />
      <RecordsCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Learning</CardTitle>
          <CardDescription>When and where lessons are kept. See the Memory page to read, edit and delete them.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="When to learn" info="Turns the learning step on or off. When on, Foreman reads each Claude Code session once it ends and keeps any lessons worth remembering. When off, nothing new is learned and no lessons are added to briefs. It is on by default." hint={WHEN_HINT[when]} htmlFor="learn-enabled">
            <Select value={when} onValueChange={(v) => save.mutate({ learn: { enabled: v === 'finished' } })}>
              <SelectTrigger id="learn-enabled" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="finished">When a session finishes</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Learn every N messages" info="A session is only learned from on its own after you have sent this many new messages since its last learn, so learning runs less often and costs fewer tokens. 0 learns after every finished turn. Closing a tile and Learn now always learn. The default is 10." hint="Waits for this many new messages before learning on its own. 0 means after every turn." htmlFor="learn-every">
            <NumberField id="learn-every" value={l.everyTurns} min={0} max={1000} onCommit={(n) => save.mutate({ learn: { everyTurns: n } })} />
          </Row>
          <Row label="Learn from the active session" hint={runReason ?? 'Runs now on the Claude Code session in the focused terminal tile.'}>
            <Button
              variant="outline"
              size="sm"
              disabled={runReason != null || runNow.isPending}
              onClick={() =>
                runNow.mutate([activeTile!, false], {
                  onSuccess: (r) => toast(r ? learnOutcomeText(r) : 'The learn step did not run', !!r?.error && !r.error.startsWith('Skipped')),
                  onError: fail,
                })
              }
            >
              Run now
            </Button>
          </Row>
          {LEARN_STORES.map((id) => (
            <Row key={id} info={STORE_INFO[id]} label={`Write to ${STORE_LABEL[id]}`} hint={STORE_HINT[id]} htmlFor={`learn-${id}`}>
              <Switch id={`learn-${id}`} disabled={!l.enabled} checked={l[id]} onCheckedChange={(v) => save.mutate({ learn: { [id]: v } })} />
            </Row>
          ))}
          {save.error != null && (
            <p role="alert" className="text-destructive py-3 text-xs">
              {errorText(save.error)}
            </p>
          )}
          <details className="group py-3">
            <summary className="cursor-pointer text-sm font-medium select-none">Limits</summary>
            <div className="divide-y pt-1">
              <Row label="Calls per review" info="Sets the most requests to the AI that a single review may send, including retries. Lower values keep costs down but may cut a review short. 0 means no limit, which is the default." hint="Includes validation retries. 0 means no limit." htmlFor="learn-calls">
                <NumberField id="learn-calls" value={l.maxCallsPerReview} min={0} max={50} onCommit={(n) => save.mutate({ learn: { maxCallsPerReview: n } })} />
              </Row>
              <Row label="Tokens per review" info="Sets the most text, counted in tokens (small chunks of words), that one review may send to the AI. Lower values save money but may stop a long session being fully read. 0 means no limit, which is the default." hint="0 means no limit." htmlFor="learn-tokens">
                <NumberField id="learn-tokens" value={l.maxTokensPerReview} min={0} max={2000000} onCommit={(n) => save.mutate({ learn: { maxTokensPerReview: n } })} />
              </Row>
              <Row label="Changes per review" info="Sets the most lessons one review may add or change, so a single session cannot flood your memory. Once the cap is reached the review stops making changes. 0 means no limit, which is the default." hint="0 means no limit." htmlFor="learn-changes">
                <NumberField id="learn-changes" value={l.maxChangesPerReview} min={0} max={100} onCommit={(n) => save.mutate({ learn: { maxChangesPerReview: n } })} />
              </Row>
              <Row label="Validation retries" info="If the AI replies in a form Foreman cannot read, it is asked again up to this many times. More retries rescue more reviews but can use more of your plan or credit. The default is 1." htmlFor="learn-retries">
                <NumberField id="learn-retries" value={l.validationRetries} min={0} max={5} onCommit={(n) => save.mutate({ learn: { validationRetries: n } })} />
              </Row>
              <Row info="Sets the most money learning may spend in one day. Once reached, further reviews are blocked until the next day. If you also set a daily cap for background AI jobs, the lower of the two applies. 0 means no cap, which is the default." label={`Daily budget (${symbol})`} hint="0 means no cap." htmlFor="learn-usd">
                <NumberField id="learn-usd" value={toField(l.dailyUsdBudget)} min={0} max={10000000} step="0.01" onCommit={(n) => save.mutate({ learn: { dailyUsdBudget: fromField(n) } })} />
              </Row>
              <Row label="When a limit is hit" info="Chooses what happens when a review hits one of the limits above. Stop ends the review. Stop and confirm also ends it but lets you choose to carry on past the limit afterwards. The default is Stop." hint="Stop ends the run. Confirm stops it and waits for you." htmlFor="learn-onlimit">
                <Select value={l.onLimit} onValueChange={(v) => save.mutate({ learn: { onLimit: v as LearnOnLimit } })}>
                  <SelectTrigger id="learn-onlimit" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stop">Stop</SelectItem>
                    <SelectItem value="confirm">Stop and confirm</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Minimum user turns" info="A session with fewer of your own messages than this is skipped, because short chats rarely hold lasting lessons. Skipped sessions cost nothing, as no AI call is made. The default is 3." hint="Shorter sessions are skipped without a model call." htmlFor="learn-turns">
                <NumberField id="learn-turns" value={l.minUserTurns} min={0} max={100} onCommit={(n) => save.mutate({ learn: { minUserTurns: n } })} />
              </Row>
              <Row label="Minimum tokens" info="A session with less text than this, counted in tokens (small chunks of words), is skipped without calling the AI. Raise it to learn only from bigger sessions. The default is 500." hint="Smaller sessions are skipped without a model call." htmlFor="learn-mintokens">
                <NumberField id="learn-mintokens" value={l.minTokens} min={0} max={10000000} onCommit={(n) => save.mutate({ learn: { minTokens: n } })} />
              </Row>
              <Row label="Learn when idle (minutes)" info="Starts learning from a Claude session by itself once its transcript has not grown for this many minutes, as long as it is not mid-turn. A session also gets reviewed a few seconds after a turn finishes. 0 turns this off. The default is 5." hint="Learns from a Claude session on its own after it has been quiet this long, or right after a turn finishes. 0 turns it off; closing a tile still learns." htmlFor="learn-idle">
                <NumberField id="learn-idle" value={l.idleMinutes} min={0} max={1440} onCommit={(n) => save.mutate({ learn: { idleMinutes: n } })} />
              </Row>
            </div>
          </details>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Learning AI</CardTitle>
          <CardDescription>
            Which AI reads a finished session and picks the lessons. Leave the model empty for a cheap default. Every learn run (and each Test) is a real call to
            that CLI, so it uses your plan or API credit; a bigger model costs more for little gain here.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row info="Chooses which AI reads your sessions and picks the lessons: Claude Code, OpenCode, or a model server on your own computer. Leaving the model empty uses a cheap default, and a bigger model costs more for little gain. Changes apply from the next review." label={local ? 'AI and model' : 'CLI, model and effort'} hint="Applies to the next learn run.">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select value={l.cli} onValueChange={(cli) => save.mutate({ learn: { cli: cli as LearnCli, model: '', effort: '' } })}>
                <SelectTrigger aria-label="Learning CLI" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude Code</SelectItem>
                  <SelectItem value="opencode">OpenCode</SelectItem>
                  <SelectItem value="local">Local model server</SelectItem>
                </SelectContent>
              </Select>
              {local ? (
                <Select value={l.model || '__first'} onValueChange={(model) => save.mutate({ learn: { model: model === '__first' ? '' : model } })}>
                  <SelectTrigger aria-label="Learning model" className="w-52 min-w-0 font-mono text-xs">
                    <SelectValue placeholder={localModels.isFetching ? 'Loading models…' : 'Model'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__first">First model the server lists</SelectItem>
                    {(localModels.data?.models ?? []).map((m) => (
                      <SelectItem key={m} value={m} className="font-mono text-xs">
                        {m}
                      </SelectItem>
                    ))}
                    {l.model && !(localModels.data?.models ?? []).includes(l.model) && <SelectItem value={l.model}>{l.model}</SelectItem>}
                  </SelectContent>
                </Select>
              ) : (
                <ModelEffortSelect
                  label="Learning"
                  cli={l.cli as 'claude' | 'opencode'}
                  model={l.model}
                  onModelChange={(model) => save.mutate({ learn: { model } })}
                  effort={l.effort}
                  onEffortChange={(effort) => save.mutate({ learn: { effort } })}
                  className="justify-end"
                />
              )}
            </div>
          </Row>
          {local && (
            <>
              <Row label="Endpoint" info="Where Foreman finds your local AI server, such as LM Studio or Ollama. Any server that speaks the OpenAI format works. If the address is wrong, the list of models cannot load and learning with this server fails. The default is http://127.0.0.1:1234." hint="LM Studio is http://127.0.0.1:1234. Ollama is http://127.0.0.1:11434. Any OpenAI-compatible server works.">
                <CommitInput id="learn-local-url" aria-label="Local server endpoint" className="w-72 font-mono text-xs" value={l.localUrl} onCommit={(v) => save.mutate({ learn: { localUrl: v } })} />
              </Row>
              {localModels.data?.error && (
                <p role="alert" className="text-destructive py-2 text-xs">
                  Could not list models: {localModels.data.error}
                </p>
              )}
              <Row label="API key" info="Only needed if your local AI server requires a password. It is saved encrypted and sent with each request to that server. Most local servers need none, so you can leave it empty." hint={localKey.data ? 'A key is saved (encrypted). Leave empty to clear it.' : 'Most local servers need none.'}>
                <div className="flex items-center gap-2">
                  <Input aria-label="Local server API key" type="password" className="w-48" placeholder={localKey.data ? 'Saved' : 'None'} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
                  <Button variant="outline" size="sm" disabled={setKey.isPending || (keyDraft === '' && !localKey.data)} onClick={() => setKey.mutate([keyDraft], { onSuccess: () => setKeyDraft('') })}>
                    {keyDraft === '' ? 'Clear' : 'Save'}
                  </Button>
                </div>
              </Row>
              <Row label="Allow plain http outside my network" info="Foreman normally refuses a plain http address that is not on this PC or your home network, because what you send could be read in transit. Turning this on allows it anyway. Leave it off unless you trust the connection. It is off by default." hint="Off refuses an http endpoint that is not on this PC or the LAN, since prompts would travel unencrypted." htmlFor="learn-local-insecure">
                <Switch id="learn-local-insecure" checked={l.localInsecureOk} onCheckedChange={(v) => save.mutate({ learn: { localInsecureOk: v } })} />
              </Row>
              <p className="text-muted-foreground py-3 text-xs">
                Small local models may extract poor lessons. Check what it writes on the Memory page.
              </p>
            </>
          )}
          <Row
            label="Will use"
            hint={picked?.error ? undefined : picked?.isDefault ? 'The cheap default for this CLI' : 'Your choice'}
          >
            <span className={picked?.error ? 'text-destructive max-w-80 text-xs' : 'font-mono text-xs'} data-testid="learn-ai-resolved">
              {picked ? (picked.error ?? `${picked.model}${picked.effort ? ` · ${picked.effort}` : ''}`) : 'Looking up…'}
            </span>
          </Row>
          <Row label="Test" hint="Sends one tiny made-up session to the AI and reports whether it answered.">
            <div className="flex items-center gap-3">
              {result && (
                <span role="status" className={result.ok ? 'text-xs text-emerald-400' : 'text-destructive max-w-72 text-xs'} data-testid="learn-ai-result">
                  {result.ok ? `OK, ${(result.ms / 1000).toFixed(1)} s` : `Failed after ${(result.ms / 1000).toFixed(1)} s: ${result.error}`}
                </span>
              )}
              <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate([])}>
                {test.isPending ? 'Testing…' : 'Test'}
              </Button>
            </div>
          </Row>
        </CardContent>
      </Card>
    </>
  )
}
