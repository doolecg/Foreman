import { useEffect, useState } from 'react'
import { decodeIpcError } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_CREW_BROWSER, sanitizeCrewBrowser, type CertMode, type CrewBrowserOptions } from '@shared/browser-compat'
import type { CookieImportPreview } from '@shared/browser-inspect'
import { call, useCrews, useSaveSettings, useSettings } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { CommitInput, ConfirmDialog, Row } from '../parts'

const headersToText = (o: CrewBrowserOptions) => o.headers.map((h) => `${h.name}: ${h.value}`).join('\n')
const textToHeaders = (t: string) =>
  t
    .split('\n')
    .map((l) => {
      const i = l.indexOf(':')
      return i > 0 ? { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : null
    })
    .filter((h): h is { name: string; value: string } => h !== null)

function HeadersInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Textarea
      id="browser-headers"
      aria-label="Custom request headers"
      className="h-20 w-80 font-mono text-xs"
      spellCheck={false}
      placeholder="Name: value, one per line"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  )
}

export function BrowserSection() {
  const settings = useSettings().data
  const save = useSaveSettings()
  const crews = (useCrews().data ?? []).filter((c) => c.kind !== 'playground')
  const [crewId, setCrewId] = useState<string>('')
  const [compatId, setCompatId] = useState<string>('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<CookieImportPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const b = settings?.browser
  if (!b) return null
  const crew = crews.find((c) => String(c.id) === crewId)
  const compatCrew = crews.find((c) => String(c.id) === compatId) ?? crews[0]
  const opts: CrewBrowserOptions = compatCrew ? (b.perCrew[String(compatCrew.id)] ?? DEFAULT_CREW_BROWSER) : DEFAULT_CREW_BROWSER
  const setOpts = (patch: Partial<CrewBrowserOptions>) => {
    if (!compatCrew) return
    save.mutate({ browser: { perCrew: { ...b.perCrew, [String(compatCrew.id)]: sanitizeCrewBrowser({ ...opts, ...patch }) } } })
  }

  const clear = async () => {
    if (!crew) return
    setBusy(true)
    setError(null)
    try {
      const { cookies } = await call('browser:clearData', crew.id)
      toast(`Cleared the browser data of ${crew.name}: ${cookies} ${cookies === 1 ? 'cookie' : 'cookies'}.`)
      setConfirming(false)
    } catch (e) {
      setError(decodeIpcError(e).message)
    } finally {
      setBusy(false)
    }
  }

  // Look at the default browser (counts only, no values) and open the confirm dialog, or report why nothing can be imported.
  const startImport = async () => {
    setImportBusy(true)
    setImportError(null)
    try {
      const p = await call('browser:importCookiesPreview')
      if (!p.supported) {
        setImportError(p.reason ?? 'Importing from your default browser is not supported.')
        return
      }
      if (p.needsClose) {
        setImportError(p.reason ?? 'Close your browser and try again.')
        return
      }
      if (p.found === 0) {
        setImportError(p.locked > 0 ? (p.reason ?? `${p.browser} locks all of its cookies.`) : `No cookies were found in ${p.browser}.`)
        return
      }
      setPreview(p)
    } catch (e) {
      setImportError(decodeIpcError(e).message)
    } finally {
      setImportBusy(false)
    }
  }

  const runImport = async () => {
    setImportBusy(true)
    setImportError(null)
    try {
      const r = await call('browser:importCookies')
      const parts = [`Imported ${r.imported} ${r.imported === 1 ? 'cookie' : 'cookies'} from ${r.browser}`]
      const notes: string[] = []
      if (r.rejected > 0) notes.push(`${r.rejected} skipped`)
      if (r.locked > 0) notes.push(`${r.locked} locked by ${r.browser}`)
      toast(`${parts[0]}${notes.length ? ` (${notes.join(', ')})` : ''}.`)
      setPreview(null)
    } catch (e) {
      setImportError(decodeIpcError(e).message)
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Browser</CardTitle>
          <CardDescription>Each project has its own browser tile with its own saved logins. Open it from the globe button on the project row.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Let the AI use the browser" hint="Claude tiles can open pages, click and type in the project's browser. You can take control at any time. Takes effect after restart." info="When on, Claude tiles can open pages, click and type in the project's built-in browser, and you can still take over at any time. When off, Claude cannot reach the browser at all. It is on by default and changes apply after a restart." htmlFor="browser-ai">
            <Switch id="browser-ai" checked={b.aiControl} onCheckedChange={(v) => save.mutate({ browser: { aiControl: v } })} />
          </Row>
          <Row label="Open documents in the browser" hint="New HTML and Markdown files Claude writes in docs, plans, specs, artifacts or design folders, and plans it presents, open in the browser tile." info="When on, a new .html, .htm or .md file that Claude creates inside a folder named docs, plans, specs, artifacts or design (or below one), and every plan Claude presents for approval, opens in the project's browser tile and shows as a readable page. Ordinary edits never open anything, and clicking a file in the Right now card always opens it, whatever this is set to. It is on by default." htmlFor="browser-auto-docs">
            <Switch id="browser-auto-docs" checked={b.autoOpenDocs} onCheckedChange={(v) => save.mutate({ browser: { autoOpenDocs: v } })} />
          </Row>
          <Row label="Home page" hint="Where a new browser or tab starts. Must be an http or https address." info="The page a new browser or tab opens on when you have not typed an address. It must start with http or https. The default is DuckDuckGo." htmlFor="browser-home">
            <CommitInput id="browser-home" value={b.homeUrl} className="w-80" spellCheck={false} onCommit={(v) => save.mutate({ browser: { homeUrl: v } })} />
          </Row>
          <Row label="Search address" hint="Used for text that is not an address. %s stands for what you typed." info="When you type words rather than a web address in the address bar, Foreman puts them into this address and loads the result. Write %s where your words should go. The default searches DuckDuckGo." htmlFor="browser-search">
            <CommitInput id="browser-search" value={b.searchUrl} className="w-80" spellCheck={false} onCommit={(v) => save.mutate({ browser: { searchUrl: v } })} />
          </Row>
          <Row label="AI autonomy" hint="Ask first: the AI asks you before sensitive browser actions. Full: it acts on its own." info="Ask first makes Claude wait for your approval before risky browser actions, such as paying, deleting, downloading, uploading files, running scripts or typing into password and card fields. Full lets it do these without asking. Ask first is the default." htmlFor="browser-autonomy">
            <Select value={b.autonomy} onValueChange={(v) => save.mutate({ browser: { autonomy: v === 'full' ? 'full' : 'confirm' } })}>
              <SelectTrigger id="browser-autonomy" className="w-48" aria-label="AI autonomy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confirm">Ask first</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site compatibility</CardTitle>
          <CardDescription>Options for pages that need more than the defaults, set for one project at a time. They apply to open tabs straight away.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Project" info="Each project has its own browser, so these options are saved per project. Pick the project here, then change the options below. They affect only that project and apply to its open tabs straight away." htmlFor="browser-compat-project">
            <Select value={compatCrew ? String(compatCrew.id) : ''} onValueChange={setCompatId}>
              <SelectTrigger id="browser-compat-project" className="w-48" aria-label="Project for site compatibility">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {crews.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {compatCrew && (
            <>
              <Row label="Ignore certificate errors" hint="Auto only lets localhost, 127.0.0.1, ::1, .test and .local through. On accepts every bad certificate, so use it only for sites you trust." info="A certificate proves a site is who it says it is. Auto lets only local test addresses (localhost, 127.0.0.1, .test, .local) open with a bad certificate. On allows every site, which is risky. Off blocks them all. Auto is the default." htmlFor="browser-certs">
                <Select value={opts.ignoreCertErrors} onValueChange={(v) => setOpts({ ignoreCertErrors: v as CertMode })}>
                  <SelectTrigger id="browser-certs" className="w-48" aria-label="Ignore certificate errors">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (local sites only)</SelectItem>
                    <SelectItem value="on">On (every site)</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Relax cross-origin checks (CORS)" hint="Lets pages in this project call APIs on other origins. For local development only; the toolbar shows a warning while it is on." info="Browsers normally stop a page calling a server on a different address (CORS). When on, this project's browser answers those checks permissively so local test pages can call other servers. Use it only while developing. It is off by default." htmlFor="browser-cors">
                <Switch id="browser-cors" checked={opts.relaxCors} onCheckedChange={(v) => setOpts({ relaxCors: v })} />
              </Row>
              <Row label="Proxy" hint="For example http://127.0.0.1:8080 or socks5://host:1080. Empty means no proxy." info="Routes everything this project's browser loads through a proxy server, for example to inspect traffic or reach a company network. Type an address like http://127.0.0.1:8080 or socks5://host:1080. Leave it empty for no proxy, which is the default." htmlFor="browser-proxy">
                <CommitInput id="browser-proxy" value={opts.proxy} className="w-80" spellCheck={false} onCommit={(v) => setOpts({ proxy: v })} />
              </Row>
              <Row label="Custom request headers" hint="Sent with every request of this project's browser. Stored in plain text." info="Each header is added to every request this project's browser sends, for example an access token a test site expects. Up to 20 headers are kept. They are stored as plain text, so do not paste secrets you want kept private." htmlFor="browser-headers">
                <HeadersInput value={headersToText(opts)} onCommit={(v) => setOpts({ headers: textToHeaders(v) })} />
              </Row>
              <Row label="User agent" hint="Empty uses a normal Chrome user agent." info="The user agent is the label a browser sends so sites know what it is. Leave this empty and Foreman sends a normal Chrome one, which is the default. Fill it in only if a site needs a different label, such as a mobile phone." htmlFor="browser-ua">
                <CommitInput id="browser-ua" value={opts.userAgent} className="w-80" spellCheck={false} onCommit={(v) => setOpts({ userAgent: v })} />
              </Row>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Browser data</CardTitle>
          <CardDescription>Cookies, logins and site data are kept per project. Clearing one project leaves the others alone.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Clear browser data" hint="Signs the project out of every site." info="Clears cookies, saved site data and the cache for the chosen project, so you are signed out of every site there. Other projects keep their logins. You cannot undo it, so you would need to sign in again." htmlFor="browser-clear-project">
            <div className="flex items-center gap-2">
              <Select value={crewId} onValueChange={setCrewId}>
                <SelectTrigger id="browser-clear-project" className="w-48" aria-label="Project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {crews.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="destructive" size="sm" disabled={!crew} onClick={() => setConfirming(true)}>
                {crew ? `Clear browser data for ${crew.name}` : 'Clear browser data'}
              </Button>
            </div>
          </Row>
          <Row label="Import cookies from your browser" hint="Copies the logins from your computer's default browser into every project's browser." info="Reads the cookies from your computer's default web browser (its main profile) and copies them into every project's built-in browser, so you start out signed in to the same sites. Nothing is read until you click, and nothing is copied until you confirm the count. Some browsers lock their cookies so only they can read them; those are left out and counted. On macOS your system may ask permission to read the browser's keychain entry.">
            <div className="flex flex-col items-end gap-1">
              <Button variant="outline" size="sm" disabled={importBusy} onClick={() => void startImport()}>
                Import cookies from your browser
              </Button>
              {importError && (
                <p role="alert" className="text-destructive text-sm">
                  {importError}
                </p>
              )}
            </div>
          </Row>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        title={`Clear browser data for ${crew?.name ?? ''}?`}
        confirmLabel="Clear"
        busy={busy}
        error={error}
        onConfirm={() => void clear()}
        onClose={() => {
          setConfirming(false)
          setError(null)
        }}
      >
        <p>Every cookie, login and saved site data of this project's browser goes, and its cache. Open tabs stay open but are signed out. The count of cookies removed is shown when it is done.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={preview !== null}
        title={preview ? `Import cookies from ${preview.browser}?` : 'Import cookies'}
        confirmLabel="Import"
        destructive={false}
        busy={importBusy}
        error={importError}
        onConfirm={() => void runImport()}
        onClose={() => {
          setPreview(null)
          setImportError(null)
        }}
      >
        <p>
          {preview?.found} {preview?.found === 1 ? 'cookie' : 'cookies'} from {preview?.browser} (profile {preview?.profile}) will be copied into every project's browser, so you start signed in to the same sites.
          {preview && preview.locked > 0 ? ` ${preview.locked} ${preview.locked === 1 ? 'cookie is' : 'cookies are'} locked by ${preview.browser} and cannot be imported.` : ''}
        </p>
      </ConfirmDialog>
    </>
  )
}
