import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { KeepWarmLine } from './KeepWarmLine'
import { DictationButton } from './DictationButton'
import { useDictation } from './useDictation'
import { keyReleases, matches, matchesMouseEvent, mouseButtonOfAccel } from '@/lib/keys'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Check, ChevronDown, Command, CornerDownLeft, Loader2, Plus, Sparkles, Square, StickyNote, Undo2, X } from 'lucide-react'
import type { ChatState } from '@shared/claude-chat'
import { describeEnhanceContext } from '@shared/prompt-enhance'
import { bridge } from '@/lib/bridge'
import { useInstallStatus, useSaveSettings, useSettings } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { applySuggestion, currentModel, filterCommands, highlightParts, modeLabel, modeOptions, nextMode, triggerAt, withLocalCommands, type Trigger } from './chatHelpers'
import { EffortPopover } from './EffortPopover'
import { setActivity } from './activityStore'
import { CommandMenu } from './CommandMenu'
import { CompactPill } from './CompactPill'
import { ImageChip } from './ImageChip'
import { InfoRow } from './InfoRow'
import { QueueStrip } from './QueueStrip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { chatActions, onComposerRestore } from './useChat'
import { altEnterTarget, editRefusal, planSteer } from '@shared/chat-queue'

interface Attachment {
  name: string
  mediaType: string
  base64: string
  preview: string
}

// The box starts as one line and grows up to this share of the tile's height, then scrolls.
const MAX_SHARE = 0.4
// Kept while the app runs so a chat bar keeps its text (and the last enhanced prompt) across project, and Settings switches.
const drafts = new Map<number, string>()
const lastEnhanced = new Map<number, string>()
// The chats whose owner chose to keep the full history instead of compacting before the next message.
const keepFull = new Set<number>()
const toolbarBtn ='text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-[26px] items-center gap-1 rounded-[7px] px-2 text-[13px] disabled:opacity-50'

const readImage = (file: File): Promise<Attachment | null> =>
  new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      const comma = url.indexOf(',')
      resolve(comma < 0 ? null : { name: file.name || 'image.png', mediaType: file.type || 'image/png', base64: url.slice(comma + 1), preview: url })
    }
    r.onerror = () => resolve(null)
    r.readAsDataURL(file)
  })

// The words of `text` that contain what the owner typed sit in a soft green chip.
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-success/20 text-foreground rounded-md px-1 py-px">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

interface Props {
  scratchId: number
  state: ChatState
  // The effort the tile was launched with (shown as "Default" in the effort popover).
  launchEffort: string | null
  // The tile's saved model: shown (and its efforts offered) before Claude has reported one, i.e. before the first message.
  tileModel: string | null
  disabled?: boolean
  onSent: () => void
}

export function Composer({ scratchId, state, launchEffort, tileModel, disabled, onSent }: Props) {
  const qc = useQueryClient()
  const [text, setTextState] = useState(() => drafts.get(scratchId) ?? '')
  const setText = (v: string | ((t: string) => string)) =>
    setTextState((t) => {
      const next = typeof v === 'function' ? v(t) : v
      if (next) drafts.set(scratchId, next)
      else drafts.delete(scratchId)
      return next
    })
  const [caret, setCaret] = useState(0)
  const [images, setImages] = useState<Attachment[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [recall, setRecall] = useState(-1)
  const appSettings = useSettings().data
  const saveSettings = useSaveSettings()
  const notesOpen = appSettings?.layout.notesOpen ?? false
  const keepWarmOn = useSettings().data?.mods.keepWarm ?? true
  const commandMenuOn = useSettings().data?.mods.commandMenu ?? true
  const allCommands = withLocalCommands(state.commands, keepWarmOn)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPick, setMenuPick] = useState<string | null>(null)
  const [enhancing, setEnhancing] = useState(false)
  const [undo, setUndo] = useState<string | null>(null)
  // The last rewrite, when the box changed while it ran: it waits for "Use rewrite" or "Discard".
  const [held, setHeld] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ note: string } | null>(null)
  const enhanceRun = useRef(0)
  const textNow = useRef(text)
  textNow.current = text
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const running = state.turn.phase === 'working' || state.turn.phase === 'waiting'
  const model = currentModel(state, tileModel)
  const modelName = state.modelDisplayName ?? model?.displayName ?? state.model
  const history = useMemo(() => state.items.filter((i) => i.kind === 'user' && i.parent === null).map((i) => (i.kind === 'user' ? i.text : '')).reverse(), [state.items])

  // Auto-grow from one line to 40% of the tile's height; shrinks back when the text goes. It is measured again when
  // the box's width changes: measured while the tile was still laying out (width near 0) the placeholder wraps a
  // word per line and the box opened at full height.
  const [areaWidth, setAreaWidth] = useState(0)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setAreaWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    const tile = el.closest<HTMLElement>('[data-chat="view"]')?.clientHeight ?? 0
    const max = tile > 0 ? Math.max(23, Math.round(tile * MAX_SHARE)) : 230
    const wanted = text === '' || areaWidth < 40 ? 23 : el.scrollHeight
    el.style.height = `${Math.min(Math.max(wanted, 23), max)}px`
    el.style.overflowY = wanted > max ? 'auto' : 'hidden'
  }, [text, areaWidth])

  const trigger: Trigger | null = useMemo(() => triggerAt(text, caret), [text, caret])
  const dismissKey = trigger ? `${trigger.kind}${trigger.start}` : null
  const commandHits = trigger?.kind === '/' ? filterCommands(withLocalCommands(state.commands, keepWarmOn), trigger.query) : []
  useEffect(() => {
    if (trigger?.kind !== '@') return setFiles([])
    let live = true
    const t = setTimeout(() => {
      bridge()
        .invoke('chat:files', scratchId, trigger.query)
        .then((r) => live && setFiles(r))
        .catch(() => live && setFiles([]))
    }, 80)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [trigger?.kind, trigger?.query, scratchId])
  const hits: Array<{ key: string; insert: string; label: string; hint: string }> =
    trigger?.kind === '/'
      ? commandHits.map((c) => ({ key: c.name, insert: c.name, label: `/${c.name}`, hint: c.terminalOnly ? `Opens in Terminal · ${c.description}` : c.description }))
      : trigger?.kind === '@'
        ? files.map((f) => ({ key: f, insert: f, label: f, hint: '' }))
        : []
  const suggesting = hits.length > 0 && dismissKey !== dismissed
  useEffect(() => setSel(0), [trigger?.query, trigger?.kind])

  const addFiles = async (list: File[]) => {
    const insert: string[] = []
    for (const f of list) {
      if (f.type.startsWith('image/')) {
        const a = await readImage(f)
        if (a) setImages((x) => [...x, a])
      } else {
        const p = bridge().filePath(f)
        if (p) insert.push(`@${p}`)
        else toast(`Could not attach ${f.name}`, true)
      }
    }
    if (insert.length) setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${insert.join(' ')} `)
    area.current?.focus()
  }

  const onPaste = (e: ClipboardEvent) => {
    const imgs = [...e.clipboardData.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f)
    if (imgs.length === 0) return
    e.preventDefault()
    void addFiles(imgs)
  }
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer.files.length === 0) return
    e.preventDefault()
    void addFiles([...e.dataTransfer.files])
  }

  // Rewrites the box with a cheap one-shot model call made by Foreman. The result replaces the text (editable, never sent);
  // Undo stays until the next message is sent. If the box changed while it ran, the rewrite waits for "Use rewrite".
  const enhance = async () => {
    const original = text
    if (!original.trim() || running || enhancing) return
    const run = ++enhanceRun.current
    setEnhancing(true)
    setHeld(null)
    setActivity(scratchId, { phase: 'context' })
    try {
      const commands = state.commands.map((c) => ({ name: c.name, description: c.description }))
      const context = await bridge().invoke('aux:enhanceContext', scratchId).catch(() => undefined)
      if (run !== enhanceRun.current) return
      setActivity(scratchId, { phase: 'rewrite', context: context ?? null })
      const out = await bridge().invoke('aux:enhancePrompt', original, commands, context)
      if (run !== enhanceRun.current) return
      setLastRun({ note: describeEnhanceContext(context) })
      lastEnhanced.set(scratchId, out)
      if (textNow.current.trim() !== original.trim()) {
        setHeld(out)
        setUndo(null)
        toast('You changed the prompt while it was being enhanced, so your text was kept. Use rewrite puts the rewrite in the box.')
        return
      }
      setText(out)
      setUndo(original)
      area.current?.focus()
    } catch (e) {
      if (run === enhanceRun.current) toast(`Could not enhance the prompt: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e)}`, true)
    } finally {
      if (run === enhanceRun.current) (setEnhancing(false), setActivity(scratchId, { phase: 'idle' }))
    }
  }
  const cancelEnhance = () => {
    enhanceRun.current++
    setEnhancing(false)
    setActivity(scratchId, { phase: 'idle' })
  }
  const undoEnhance = () => {
    if (undo !== null) setText(undo)
    setUndo(null)
  }
  const useHeld = () => {
    if (held === null) return
    // Undo puts back what the box held just before the rewrite, which may be newer than the text that was enhanced.
    setUndo(textNow.current)
    setText(held)
    setHeld(null)
    area.current?.focus()
  }

  const ctxPct = state.contextUsage?.percentage ?? state.context?.percentage ?? null
  const ctxUsed = state.contextUsage?.totalTokens ?? state.context?.usedTokens ?? null
  const compactTokens = ctxPct !== null && ctxUsed !== null && ctxPct >= (appSettings?.contextWarnPct ?? 60) && !running ? ctxUsed : null
  const [keepFullNow, setKeepFullNow] = useState(() => keepFull.has(scratchId))
  const toggleKeepFull = () => {
    if (keepFull.has(scratchId)) keepFull.delete(scratchId)
    else keepFull.add(scratchId)
    setKeepFullNow(keepFull.has(scratchId))
  }

  const submit = async () => {
    const body = text.trim()
    if ((!body && images.length === 0) || disabled) return
    // A command that runs only on Claude Code's screen opens the Commands menu on it instead of going to Claude.
    const name = images.length === 0 ? /^\/([^\s/]+)/.exec(body)?.[1] : undefined
    if (name && commandMenuOn && allCommands.some((c) => c.name === name && c.terminalOnly)) {
      setText('')
      setRecall(-1)
      setMenuPick(name)
      setMenuOpen(true)
      return
    }
    // A full context compacts first (Claude Code runs the next message after it) unless the owner chose to keep the history.
    if (compactTokens !== null && !keepFullNow && !body.startsWith('/') && !(await chatActions.send(scratchId, '/compact'))) return
    const ok = await chatActions.send(scratchId, body, images.map(({ mediaType, base64 }) => ({ mediaType, base64 })))
    if (!ok) return
    setText('')
    setImages([])
    setRecall(-1)
    setUndo(null)
    setHeld(null)
    setLastRun(null)
    onSent()
  }

  // The core also refuses while Claude stops or compacts (and says why in a toast).
  const steerNow = planSteer({ process: state.process, turnRunning: running, stopping: false, compacting: false, runningSubagents: 0 })
  const sendBlocked = steerNow.ok ? null : steerNow.reason

  // Edit on a queued message: it leaves the queue and its text goes into the box. A draft in the box is never replaced
  // (the edit is refused); one typed while the message was being taken keeps its text, the message goes above it.
  const editQueued = async (id: string) => {
    const refusal = editRefusal({ text, images: images.length })
    if (refusal) return toast(refusal, true)
    const m = await chatActions.queueTake(scratchId, id)
    if (!m) return toast('That message was already sent', true)
    setText((t) => (t.trim() ? `${m.text}\n\n${t}` : m.text))
    setImages((x) => [...(m.images ?? []).map((i) => ({ ...i, name: 'image.png', preview: `data:${i.mediaType};base64,${i.base64}` })), ...x])
    area.current?.focus()
  }

  // Edit from here: the rewound message returns above whatever is already in the box (same as Edit on a queued message).
  useEffect(
    () =>
      onComposerRestore(scratchId, (m) => {
        setText((t) => (t.trim() ? `${m.text}\n\n${t}` : m.text))
        setImages((x) => [...(m.images ?? []).map((i) => ({ ...i, name: 'image.png', preview: `data:${i.mediaType};base64,${i.base64}` })), ...x])
        area.current?.focus()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scratchId],
  )

  const accept = (i: number) => {
    const h = hits[i]
    if (!h || !trigger) return
    const next = applySuggestion(text, trigger, caret, h.insert)
    setText(next.text)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(next.caret, next.caret)
      setCaret(next.caret)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (suggesting) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setSel((s) => (s + 1) % hits.length))
      if (e.key === 'ArrowUp') return (e.preventDefault(), setSel((s) => (s - 1 + hits.length) % hits.length))
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) return (e.preventDefault(), accept(sel))
      if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), setDismissed(dismissKey))
    }
    if (e.key === 'Enter' && e.altKey) {
      const id = altEnterTarget({ text, images: images.length }, state.queue)
      if (id) return (e.preventDefault(), chatActions.queueSend(scratchId, id))
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      chatActions.setMode(scratchId, nextMode(state))
    } else if (e.key === 'ArrowUp' && (text === '' || recall >= 0) && history.length > 0 && !e.shiftKey) {
      const i = Math.min(history.length - 1, recall + 1)
      e.preventDefault()
      setRecall(i)
      setText(history[i]!)
    } else if (e.key === 'ArrowDown' && recall >= 0) {
      e.preventDefault()
      const i = recall - 1
      setRecall(i)
      setText(i >= 0 ? history[i]! : '')
    }
  }

  function insertAtCaret(words: string) {
    const el = area.current
    const at = el ? el.selectionStart : text.length
    const end = el ? el.selectionEnd : text.length
    const before = text.slice(0, at)
    const piece = `${before && !/\s$/.test(before) ? ' ' : ''}${words}`
    setText(`${before}${piece}${text.slice(end)}`)
    setCaret(at + piece.length)
    el?.focus()
  }

  const dictation = useDictation(insertAtCaret)
  const dictateKey = useSettings().data?.keybinds.dictate ?? ''
  const dictationOn = useSettings().data?.dictation.enabled ?? true
  const speechReady = useInstallStatus().data?.find((s) => s.id === 'dictation')?.state === 'installed' && dictationOn
  const holdMode = useSettings().data?.dictation.mode === 'hold'
  const toggleDictation = dictation.toggle
  const { holdStart, holdEnd } = dictation
  useEffect(() => {
    if (!dictateKey || !speechReady) return
    const mouseButton = mouseButtonOfAccel(dictateKey)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (document.activeElement !== area.current || !matches(e, dictateKey)) return
      e.preventDefault()
      if (!holdMode) return toggleDictation()
      if (!e.repeat) void holdStart()
    }
    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      if (holdMode && keyReleases(e, dictateKey)) holdEnd()
    }
    const onMouseDown = (e: globalThis.MouseEvent) => {
      if (document.activeElement !== area.current || !matchesMouseEvent(e, dictateKey)) return
      e.preventDefault()
      if (holdMode) void holdStart()
      else toggleDictation()
    }
    const onMouseUp = (e: globalThis.MouseEvent) => {
      if (holdMode && e.button === mouseButton) holdEnd()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', holdEnd)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', holdEnd)
    }
  }, [dictateKey, speechReady, toggleDictation, holdMode, holdStart, holdEnd])

  const blocked = state.process === 'blocked'
  const placeholder = state.process === 'starting' ? 'Starting Claude Code…' : 'Type / for commands'
  const canSend = (text.trim() !== '' || images.length > 0) && !disabled

  return (
    <div className="shrink-0 px-4 pt-1.5 pb-3.5" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {state.queue.length > 0 && <QueueStrip queue={state.queue} sendBlocked={sendBlocked} onEdit={(id) => void editQueued(id)} onMove={(id, by) => chatActions.queueMove(scratchId, id, by)} onSend={(id) => chatActions.queueSend(scratchId, id)} onRemove={(id) => chatActions.queueRemove(scratchId, id)} />}
      <div className="relative mx-auto max-w-[720px]">
        {suggesting && (
          <div role="listbox" aria-label={trigger?.kind === '/' ? 'Commands' : 'Files'} className="bg-popover border-border absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-[18px] border p-1.5 shadow-[0_10px_30px_rgba(0,0,0,.18)] dark:shadow-[0_10px_30px_rgba(0,0,0,.45)]">
            {hits.map((h, i) => (
              <button
                key={h.key}
                ref={i === sel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                type="button"
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => (e.preventDefault(), accept(i))}
                onMouseEnter={() => setSel(i)}
                className={cn('flex w-full items-baseline gap-3.5 rounded-xl px-3 py-2 text-left', i === sel && 'bg-foreground/[0.07]')}
              >
                <span className={cn('shrink-0 text-[15px] font-bold', trigger?.kind === '@' && 'min-w-0 truncate font-mono text-[13px] font-semibold')}>
                  {trigger?.kind === '@' ? <Highlighted text={h.label} query={trigger.query} /> : h.label}
                </span>
                {h.hint && (
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">
                    <Highlighted text={h.hint} query={trigger?.query ?? ''} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className={cn('border-primary/30 bg-card rounded-[22px] border py-2 pr-2 pl-2', dictation.state === 'recording' && 'chat-ai-border')}>
          {images.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 pl-1.5">
              {images.map((im, i) => (
                <ImageChip key={i} src={im.preview} name={im.name} onRemove={() => setImages((x) => x.filter((_, k) => k !== i))} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(toolbarBtn, 'w-[26px] justify-center px-0')} aria-label="Attach">
                <Plus className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem onSelect={() => picker.current?.click()}>Upload file or image</DropdownMenuItem>
                <div className="text-muted-foreground px-2 py-1 text-xs">Paste an image with Ctrl+V</div>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={picker} type="file" multiple hidden onChange={(e) => (void addFiles([...(e.target.files ?? [])]), (e.target.value = ''))} />

            {speechReady && <DictationButton dictation={dictation} />}

            <textarea
              ref={area}
              data-chat-composer
              aria-label="Message Claude"
              rows={1}
              value={text}
              disabled={blocked}
              placeholder={blocked ? 'Claude Code is unavailable' : placeholder}
              onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart), setRecall(-1))}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              className={cn('placeholder:text-muted-foreground/70 min-h-[23px] flex-1 resize-none self-center border-0 bg-transparent p-0 text-[15px] leading-[23px] outline-none', (running || dictation.state !== 'idle') && 'pr-6')}
            />
            <DropdownMenu>
              <DropdownMenuTrigger className={toolbarBtn} aria-label={`Permission mode: ${modeLabel(state.permissionMode)}`} title="Permission mode (Shift+Tab)">
                {modeLabel(state.permissionMode)}
                <ChevronDown className="size-3" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                {modeOptions(state).map((m) => (
                  <DropdownMenuItem key={m} onSelect={() => chatActions.setMode(scratchId, m)}>
                    <span className="flex-1">{modeLabel(m)}</span>
                    {m === state.permissionMode && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger className={toolbarBtn} aria-label={`Model: ${modelName ?? 'unknown'}`} disabled={state.models.length === 0}>
                {modelName ?? 'Model'}
                <ChevronDown className="size-3" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-72">
                {state.models.map((m) => (
                  <DropdownMenuItem key={m.value} onSelect={() => void chatActions.setModel(scratchId, m.value).then(() => qc.invalidateQueries({ queryKey: ['scratchViews'] }))} className="items-start">
                    <span className="min-w-0 flex-1">
                      <span className="block">{m.displayName}</span>
                      {m.description && <span className="text-muted-foreground block text-xs">{m.description}</span>}
                    </span>
                    {model?.value === m.value && <Check className="mt-0.5 size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <EffortPopover model={model} modelName={modelName} effort={state.effort} defaultLevel={launchEffort} onChange={(l) => chatActions.setEffort(scratchId, l)} triggerClass={toolbarBtn} />
            {compactTokens !== null && <CompactPill tokens={compactTokens} keepFull={keepFullNow} onToggle={toggleKeepFull} />}
            {dictation.state !== 'idle' && (
              <span role="status" className="text-muted-foreground shrink-0">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                <span className="sr-only">{dictation.state === 'recording' ? 'Listening' : dictation.state === 'loading' ? 'Loading speech model' : 'Transcribing'}</span>
              </span>
            )}
            {running ? (
              <button type="button" aria-label="Stop" title="Stop (Esc)" onClick={() => chatActions.interrupt(scratchId)} className="stop-glow bg-foreground text-background grid size-[30px] shrink-0 place-items-center rounded-full hover:opacity-90">
                <Square className="size-[9px] fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                title="Send (Enter)"
                disabled={!canSend}
                onClick={() => void submit()}
                className={cn('grid size-[30px] shrink-0 place-items-center hover:opacity-90', canSend ? 'bg-primary text-primary-foreground rounded-[10px]' : 'bg-foreground text-background rounded-full opacity-40')}
              >
                {canSend ? <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden /> : <CornerDownLeft className="size-[15px]" aria-hidden />}
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {enhancing ? (
            <>
              <span role="status" className="bg-accent text-foreground inline-flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[13px]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Enhancing…
              </span>
              <button type="button" onClick={cancelEnhance} title="Cancel" aria-label="Cancel enhancing" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px] underline-offset-2 hover:underline">
                <X className="size-3.5" aria-hidden /> Cancel
              </button>
            </>
          ) : (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => void enhance()}
                  disabled={!text.trim() || running}
                  title={running ? 'Wait for Claude to finish' : !text.trim() ? 'Write a prompt first, then enhance it' : 'Rewrite this prompt with the files to change, context, skills to load, what to ask first and when it is done. Right-click to recover the last enhanced prompt'}
                  className="bg-accent/60 text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[13px] disabled:opacity-50 disabled:hover:bg-accent/60"
                >
                  <Sparkles className="size-3.5" aria-hidden /> Enhance prompt
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem disabled={!lastEnhanced.has(scratchId)} onSelect={() => (setText(lastEnhanced.get(scratchId) ?? ''), area.current?.focus())}>
                  Recover last enhanced prompt
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
          {!enhancing && held !== null && (
            <>
              <button type="button" onClick={useHeld} title="Put the rewrite in the box" aria-label="Use the enhanced rewrite" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px] underline-offset-2 hover:underline">
                <Check className="size-3.5" aria-hidden /> Use rewrite
              </button>
              <button type="button" onClick={() => setHeld(null)} title="Throw the rewrite away" aria-label="Discard the enhanced rewrite" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px] underline-offset-2 hover:underline">
                <X className="size-3.5" aria-hidden /> Discard
              </button>
            </>
          )}
          {!enhancing && held === null && undo !== null && (
            <button type="button" onClick={undoEnhance} title="Put your text back" aria-label="Undo the enhanced rewrite" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px] underline-offset-2 hover:underline">
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          )}
          {!enhancing && lastRun?.note && <span className="text-muted-foreground/70 text-[11px]">{lastRun.note}</span>}
          </div>
          <KeepWarmLine state={state} />
          {commandMenuOn && (
            <Popover
              open={menuOpen}
              onOpenChange={(open) => {
                setMenuOpen(open)
                if (!open) setMenuPick(null)
              }}
            >
              <PopoverTrigger className={cn(toolbarBtn, 'w-[26px] justify-center px-0')} aria-label="Claude commands" title="Claude Code commands">
                <Command className="size-3.5" aria-hidden />
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-96 p-0">
                <CommandMenu
                  commands={allCommands}
                  state={state}
                  initial={menuPick}
                  onInsert={(name) => {
                    setText(`/${name} `)
                    setMenuOpen(false)
                    area.current?.focus()
                  }}
                  onRun={(name) => {
                    setMenuOpen(false)
                    void chatActions.send(scratchId, `/${name}`)
                  }}
                />
              </PopoverContent>
            </Popover>
          )}

          <button
            type="button"
            className={cn(toolbarBtn, 'w-[26px] justify-center px-0')}
            aria-label={notesOpen ? 'Hide notes' : 'Show notes'}
            aria-pressed={notesOpen}
            title={`Notes (${appSettings?.keybinds.toggleNotes || 'unbound'})`}
            onClick={() => saveSettings.mutate({ layout: { notesOpen: !notesOpen } })}
          >
            <StickyNote className="size-3.5" aria-hidden />
          </button>

          <InfoRow state={state} />
        </div>
      </div>
    </div>
  )
}
