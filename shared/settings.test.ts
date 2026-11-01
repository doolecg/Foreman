import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, KEY_ACTIONS, mergeSettings, sanitizeSettings } from './settings'

describe('settings', () => {
  it('fills defaults for missing or malformed values', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    const s = sanitizeSettings({
      dailyBudgetUsd: -5,
      defaultModels: { claude: '  opus ', codex: 42 },
      updates: { channel: 'nightly', checkHours: 99.4, installOnQuit: 'yes' },
      keybinds: { newCrew: 'Mod+Shift+N', addSquad: 'Mod+Shift+P', tabCost: 'Mod+3', bogus: 'X' },
    })
    expect(s.dailyBudgetUsd).toBe(0)
    expect(s.defaultModels).toEqual({ claude: 'opus' })
    expect(s.updates).toEqual({ channel: 'stable', checkHours: 24, installOnQuit: true })
    expect(s.keybinds.newCrew).toBe('Mod+Shift+N')
    expect(Object.keys(s.keybinds).sort()).toEqual(['dictate', 'mediaNext', 'mediaPlayPause', 'mediaPrev', 'mediaShuffle', 'newCrew', 'newShell', 'newThread', 'openInIde', 'openPlayground', 'openSettings', 'searchThreads', 'tileClose', 'tileFocusNext', 'tileFocusPrev', 'tileFullscreen', 'tileLayout', 'tileSplit', 'toggleAllPanels', 'toggleConsole', 'toggleNotes', 'toggleSidebar', 'zoomIn', 'zoomOut', 'zoomReset'])
    expect('defaultReview' in s).toBe(false)
  })

  it('remembers the Claude effort only as a real level', () => {
    expect(DEFAULT_SETTINGS.defaultEfforts).toEqual({ claude: '' })
    expect(sanitizeSettings({ defaultEfforts: { claude: ' xhigh ' } }).defaultEfforts).toEqual({ claude: 'xhigh' })
    expect(sanitizeSettings({ defaultEfforts: { claude: 'turbo' } }).defaultEfforts).toEqual({ claude: '' })
    expect(sanitizeSettings({ defaultEfforts: 'max' }).defaultEfforts).toEqual({ claude: '' })
    expect(mergeSettings(DEFAULT_SETTINGS, { defaultEfforts: { claude: 'max' } }).defaultEfforts).toEqual({ claude: 'max' })
    expect(mergeSettings(DEFAULT_SETTINGS, { defaultModels: { claude: 'opus' } }).defaultEfforts).toEqual({ claude: '' })
  })

  it('sanitises the dragged panel widths', () => {
    expect(sanitizeSettings({ layout: { sidebarWidth: 301.4 } }).layout).toMatchObject({ sidebarWidth: 301 })
    expect(sanitizeSettings({ layout: { sidebarWidth: -9 } }).layout).toMatchObject({ sidebarWidth: 0 })
    expect(sanitizeSettings({ layout: { sidebarWidth: 99999 } }).layout).toMatchObject({ sidebarWidth: 4000 })
  })

  it('clamps and defaults the tokens and collaboration groups', () => {
    const s = sanitizeSettings({
      tokens: { operatorDailyCapUsd: -3, capWarnPct: 500, coldThresholdPct: 'x', outputShareWarnPct: 0, defaultCacheTtl: '2h', subagentCacheTtl: '1h', pinClaudeVersion: 'no' },
      collab: { nudgeIdleSeconds: 0, leaseMinutes: 90.6, maxRejects: -1, purgeRetentionDays: 7.2, purgeEnabled: 'no', longJobElapsedMinutes: NaN },
    })
    expect(s.tokens).toEqual({
      capWarnPct: 100,
      coldThresholdPct: 50,
      defaultCacheTtl: 'auto',
      subagentCacheTtl: '1h',
      pinClaudeVersion: true,
    })
    expect(DEFAULT_SETTINGS.tokens.capWarnPct).toBe(80)
    expect(DEFAULT_SETTINGS.tokens).toMatchObject({ defaultCacheTtl: 'auto', subagentCacheTtl: '5m', pinClaudeVersion: true })
  })


  it('merges nested patches without dropping sibling values', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { updates: { channel: 'beta' }, keybinds: { newThread: '' }, dailyBudgetUsd: 25 })
    expect(s.updates).toEqual({ channel: 'beta', checkHours: 3, installOnQuit: true })
    expect(s.keybinds.newThread).toBe('')
    expect(s.keybinds.newCrew).toBe('Mod+N')
    expect(s.dailyBudgetUsd).toBe(25)
  })


  it('silently drops the old hindsight and codegraph keys', () => {
    const s = sanitizeSettings({ hindsightUrl: 'http://nas:9077', hindsight: { mode: 'remote', url: 'http://x' }, codegraph: true, keybinds: { indexCrew: 'Mod+I' } }) as Record<string, any>
    expect('hindsight' in s).toBe(false)
    expect('hindsightUrl' in s).toBe(false)
    expect('codegraph' in s).toBe(false)
    expect('indexCrew' in s.keybinds).toBe(false)
  })

  it('sanitises the hide flag, terminal and tiles settings', () => {
    const d = sanitizeSettings({})
    expect(d.layout).toEqual({ sidebarWidth: 0, sidebarHidden: false, notesOpen: false, notesWidth: 0 })
    expect(d.terminal).toEqual({ copyOnSelect: true, fontSize: 13, scrollback: 5000, fileLinks: true, dropPaths: true, rightClickPaste: true, softPrompt: true })
    expect(d.tiles).toEqual({ layout: 'dwindle', gaps: 6, strip: 'normal' })
    const bad = sanitizeSettings({
      layout: { sidebarHidden: 'yes' },
      terminal: { copyOnSelect: 1, fontSize: 99, scrollback: 10, fileLinks: false, dropPaths: 'no' },
      tiles: { layout: 'grid', gaps: -4, strip: 'big' },
    })
    expect(bad.layout).toEqual({ sidebarWidth: 0, sidebarHidden: false, notesOpen: false, notesWidth: 0 })
    expect(bad.terminal).toEqual({ copyOnSelect: true, fontSize: 32, scrollback: 500, fileLinks: false, dropPaths: true, rightClickPaste: true, softPrompt: true })
    // A saved chat composer switch from before the Chat view is dropped on load.
    expect(sanitizeSettings({ terminal: { chatComposer: true } }).terminal).toEqual({ copyOnSelect: true, fontSize: 13, scrollback: 5000, fileLinks: true, dropPaths: true, rightClickPaste: true, softPrompt: true })
    expect(bad.tiles).toEqual({ layout: 'dwindle', gaps: 0, strip: 'normal' })
    // A saved layout from before the side panel was removed keeps the project list and drops the rest.
    const old = sanitizeSettings({ layout: { sidebarHidden: true, panelHidden: true, rightWidth: 300 }, keybinds: { toggleSidePanel: 'Alt+X' } })
    expect(old.layout).toEqual({ sidebarWidth: 0, sidebarHidden: true, notesOpen: false, notesWidth: 0 })
    expect(old.keybinds).not.toHaveProperty('toggleSidePanel')
  })

  it('sanitises the main CLI, the info bar and the context thresholds', () => {
    const d = sanitizeSettings({})
    expect(d).toMatchObject({ mainCli: 'claude', infoBar: true, contextWarnPct: 60, contextDangerPct: 85 })
    expect(sanitizeSettings({ mainCli: 'codex', infoBar: 'no', contextWarnPct: 0, contextDangerPct: 500 })).toMatchObject({ mainCli: 'claude', infoBar: true, contextWarnPct: 1, contextDangerPct: 100 })
    expect(sanitizeSettings({ mainCli: 'opencode', infoBar: false, contextWarnPct: 40.6 })).toMatchObject({ mainCli: 'opencode', infoBar: false, contextWarnPct: 41 })
    expect(mergeSettings(DEFAULT_SETTINGS, { mainCli: 'opencode' }).mainCli).toBe('opencode')
  })

  it('merges partial layout, terminal and tiles patches and labels every key action', () => {
    const m = mergeSettings(DEFAULT_SETTINGS, { layout: { sidebarHidden: true }, terminal: { fontSize: 16 }, tiles: { layout: 'master' } })
    expect(m.layout).toEqual({ sidebarHidden: true, sidebarWidth: 0, notesOpen: false, notesWidth: 0 })
    expect(m.terminal).toMatchObject({ fontSize: 16, scrollback: 5000 })
    expect(m.tiles).toMatchObject({ layout: 'master', gaps: 6 })
    expect(KEY_ACTIONS.map((a) => a.id).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.keybinds).sort())
    expect(KEY_ACTIONS.every((a) => a.label.length > 0)).toBe(true)
    expect(DEFAULT_SETTINGS.keybinds).toMatchObject({ toggleAllPanels: 'Alt+Z' })
  })

  it('sanitises the top bar settings and leaves media keys unbound', () => {
    expect(DEFAULT_SETTINGS.keybinds).toMatchObject({ mediaPlayPause: '', mediaNext: '', mediaPrev: '', mediaShuffle: '' })
    const t = sanitizeSettings({ topBar: { mediaSize: 'huge', clockFormat: '13', clockSeconds: 'yes', clockDate: false } }).topBar
    expect(t).toMatchObject({ mediaSize: 'full', clockFormat: 'auto', clockSeconds: false, clockDate: false })
    const m = mergeSettings(DEFAULT_SETTINGS, { topBar: { mediaSize: 'compact', clockFormat: '12', clockSeconds: true } }).topBar
    expect(m).toMatchObject({ mediaSize: 'compact', clockFormat: '12', clockSeconds: true, clockDate: true })
  })
})

describe('browser settings', () => {
  it('defaults to AI control on with a search page', () => {
    expect(DEFAULT_SETTINGS.browser).toMatchObject({ aiControl: true })
    expect(DEFAULT_SETTINGS.browser.searchUrl).toContain('%s')
  })
  it('drops malformed values', () => {
    const b = sanitizeSettings({ browser: { aiControl: 'no', homeUrl: 'javascript:alert(1)', searchUrl: 'https://s.example/' } }).browser
    expect(b).toEqual(DEFAULT_SETTINGS.browser)
  })
  it('opens documents by itself unless turned off, and ignores a non-boolean', () => {
    expect(DEFAULT_SETTINGS.browser.autoOpenDocs).toBe(true)
    expect(sanitizeSettings({ browser: { autoOpenDocs: false } }).browser.autoOpenDocs).toBe(false)
    expect(sanitizeSettings({ browser: { autoOpenDocs: 'no' } }).browser.autoOpenDocs).toBe(true)
  })
  it('keeps good values and merges a patch', () => {
    const b = mergeSettings(DEFAULT_SETTINGS, { browser: { aiControl: false, homeUrl: 'http://localhost:3000', searchUrl: 'https://s.example/?q=%s' } }).browser
    expect(b).toEqual({ ...DEFAULT_SETTINGS.browser, aiControl: false, homeUrl: 'http://localhost:3000', searchUrl: 'https://s.example/?q=%s' })
    expect(mergeSettings(DEFAULT_SETTINGS, { browser: { aiControl: false } }).browser.homeUrl).toBe(DEFAULT_SETTINGS.browser.homeUrl)
  })
})

describe('mods settings', () => {
  const allOff = { subagents: false, promptEnhancer: false, ideaShelf: false, folderTracker: false, plainEnglish: false }

  it('defaults the master switch on, the sub-agent mod on and the rest off', () => {
    expect(DEFAULT_SETTINGS.mods).toEqual({ enabled: true, mods: { ...allOff, subagents: true }, keepWarm: true, commandMenu: true })
    const off = sanitizeSettings({ mods: { enabled: false, mods: { ...allOff, subagents: false, ideaShelf: true } } }).mods
    expect(off).toEqual({ enabled: false, mods: { ...allOff, ideaShelf: true }, keepWarm: true, commandMenu: true })
  })

  it('migrates the old subagentPanel switch into mods.subagents', () => {
    expect(sanitizeSettings({ mods: { enabled: true, subagentPanel: false } }).mods.mods.subagents).toBe(false)
    expect(sanitizeSettings({ mods: { enabled: true, subagentPanel: true } }).mods.mods.subagents).toBe(true)
    // A stored mods value wins over the old flag.
    expect(sanitizeSettings({ mods: { subagentPanel: false, mods: { subagents: true } } }).mods.mods.subagents).toBe(true)
  })

  it('loads a saved chatLook switch from before the Chat view without error', () => {
    const s = sanitizeSettings({ mods: { enabled: true, mods: { chatLook: true, subagents: true } } }).mods
    expect(s).toEqual({ enabled: true, mods: { ...allOff, subagents: true }, keepWarm: true, commandMenu: true })
    expect(Object.keys(s.mods)).not.toContain('chatLook')
  })

  it('drops unknown mod ids and non-boolean values back to the defaults', () => {
    const s = sanitizeSettings({ mods: { enabled: 'no', mods: { subagents: 0, ideaShelf: true, nope: true } } }).mods
    expect(s).toEqual({ enabled: true, mods: { ...allOff, subagents: true, ideaShelf: true }, keepWarm: true, commandMenu: true })
    const gone = sanitizeSettings({ mods: { enabled: true, keepWarm: false, mods: { sessionMonitor: true, assumptionCheck: true } } }).mods
    expect(Object.keys(gone.mods)).not.toContain('sessionMonitor')
    expect(Object.keys(gone.mods)).not.toContain('assumptionCheck')
    expect(gone.keepWarm).toBe(false)
    expect(sanitizeSettings({ mods: 'yes' }).mods).toEqual({ enabled: true, mods: { ...allOff, subagents: true }, keepWarm: true, commandMenu: true })
    expect(sanitizeSettings({ mods: null }).mods).toEqual({ enabled: true, mods: { ...allOff, subagents: true }, keepWarm: true, commandMenu: true })
  })

  it('reads the old claudeMods key when there is no mods key, and writes only mods', () => {
    const out = sanitizeSettings({ claudeMods: { enabled: false, keepWarm: false, mods: { ...allOff, ideaShelf: true } } })
    expect(out.mods).toEqual({ enabled: false, mods: { ...allOff, ideaShelf: true }, keepWarm: false, commandMenu: true })
    expect(Object.keys(out)).not.toContain('claudeMods')
    expect(Object.keys(sanitizeSettings(JSON.parse(JSON.stringify(out))))).not.toContain('claudeMods')
  })

  it('reads the new mods key on its own', () => {
    const out = sanitizeSettings({ mods: { enabled: false, commandMenu: false, mods: { ...allOff, plainEnglish: true } } })
    expect(out.mods).toEqual({ enabled: false, mods: { ...allOff, plainEnglish: true }, keepWarm: true, commandMenu: false })
  })

  it('prefers mods over claudeMods when both are stored', () => {
    const out = sanitizeSettings({ claudeMods: { enabled: false, mods: { ...allOff, ideaShelf: true } }, mods: { enabled: true, mods: { ...allOff, folderTracker: true } } })
    expect(out.mods).toEqual({ enabled: true, mods: { ...allOff, folderTracker: true }, keepWarm: true, commandMenu: true })
  })

  it('falls back to the defaults for garbage under either key', () => {
    const defaults = { enabled: true, mods: { ...allOff, subagents: true }, keepWarm: true, commandMenu: true }
    for (const garbage of ['yes', 42, [], true]) {
      expect(sanitizeSettings({ claudeMods: garbage }).mods).toEqual(defaults)
      expect(sanitizeSettings({ mods: garbage }).mods).toEqual(defaults)
    }
    expect(sanitizeSettings({ claudeMods: { enabled: 'x', keepWarm: 1, mods: 'no' } }).mods).toEqual(defaults)
  })

  it('migrates an old exported backup or preset that embeds claudeMods', () => {
    const backup = { claudeMods: { enabled: true, subagentPanel: false, mods: { ideaShelf: true, sessionMonitor: true } }, dailyBudgetUsd: 7 }
    const out = sanitizeSettings(JSON.parse(JSON.stringify(backup)))
    expect(out.mods).toEqual({ enabled: true, mods: { ...allOff, ideaShelf: true }, keepWarm: true, commandMenu: true })
    expect(out.dailyBudgetUsd).toBe(7)
  })

  it('merges a partial patch without losing the other switches', () => {
    const off = mergeSettings(DEFAULT_SETTINGS, { mods: { enabled: false, mods: { ...allOff, subagents: true } } })
    expect(off.mods).toEqual({ enabled: false, mods: { ...allOff, subagents: true }, keepWarm: true, commandMenu: true })
  })
})
