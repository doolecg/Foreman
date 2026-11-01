// The settings pages: grouped into categories, each page composing one or more sections. A section id is the old
// section id, so a deep link to any old section opens its page and scrolls to that section.
export const SETTINGS_SECTION_IDS = [
  'general',
  'appearance',
  'projects',
  'topbar',
  'terminals',
  'terminal',
  'tiles',
  'mods',
  'tokens',
  'budgets',
  'presets',
  'teams',
  'backups',
  'superpowers',
  'mcp',
  'import',
  'shortcuts',
  'browser',
  'reset',
  'install',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export interface SettingsSubsection {
  id: SettingsSectionId
  label: string
}

export interface SettingsPage {
  id: string
  label: string
  description: string
  keywords?: string
  subsections: SettingsSubsection[]
}

export interface SettingsCategory {
  label: string
  pages: SettingsPage[]
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    label: 'General',
    pages: [
      { id: 'general', label: 'General', description: 'Interface size and updates.', keywords: 'scale zoom ui size display update version dictation microphone speech', subsections: [{ id: 'general', label: 'Display and updates' }] },
      { id: 'appearance', label: 'Appearance', description: 'Colour themes, accent colour and terminal colours. Changes show live.', keywords: 'theme colour color accent dark light', subsections: [{ id: 'appearance', label: 'Themes and colours' }] },
      { id: 'topbar', label: 'Top bar', description: 'The Windows media controls, the clock and date, and the top bar panel buttons.', keywords: 'clock date media scale', subsections: [{ id: 'topbar', label: 'Top bar' }] },
      { id: 'shortcuts', label: 'Shortcuts', description: 'Keyboard shortcuts. Rebind any of them here.', keywords: 'keys keybind hotkey binding', subsections: [{ id: 'shortcuts', label: 'Keyboard shortcuts' }] },
    ],
  },
  {
    label: 'Workspace',
    pages: [
      { id: 'projects', label: 'Projects', description: 'The project list, its groups, and the folder and IDE each project opens with.', keywords: 'ide folder group sidebar', subsections: [{ id: 'projects', label: 'Projects' }] },
      {
        id: 'terminals',
        label: 'Terminals',
        description: 'How terminals start and look, the text in them, and how the tiles arrange.',
        keywords: 'shell cli font scrollback tile layout composer chat message',
        subsections: [
          { id: 'terminals', label: 'Defaults for new terminals' },
          { id: 'terminal', label: 'Terminal text' },
          { id: 'tiles', label: 'Tiles' },
        ],
      },
    ],
  },
  {
    label: 'Claude & OpenCode',
    pages: [
      { id: 'mods', label: 'Mods', description: 'The features of Foreman you can turn off: the Agents panel, info bar, Keep warm, Commands menu and the Claude Code mods.', keywords: 'hooks status line subagent info bar keep warm commands engineering factory mode pack skills reset', subsections: [{ id: 'mods', label: 'Mods' }] },
      { id: 'browser', label: 'Browser', description: 'The browser tile in each project, and whether the AI may drive it.', keywords: 'browser web ai control playwright cookies home page search', subsections: [{ id: 'browser', label: 'Browser' }] },
    ],
  },
  {
    label: 'Presets',
    pages: [
      {
        id: 'presets',
        label: 'Presets',
        description: 'Saved setups for your projects, and the teams that guide them.',
        keywords: 'preset team role prompt',
        subsections: [
          { id: 'presets', label: 'Presets' },
          { id: 'teams', label: 'Teams' },
        ],
      },
    ],
  },
  {
    label: 'Usage',
    pages: [
      {
        id: 'usage',
        label: 'Tokens and budgets',
        description: 'Token warnings and caps, and the daily spend budget.',
        keywords: 'tokens budget spend cap limit cache usd',
        subsections: [
          { id: 'tokens', label: 'Tokens' },
          { id: 'budgets', label: 'Budgets' },
        ],
      },
    ],
  },
  {
    label: 'Data',
    pages: [
      {
        id: 'data',
        label: 'Data and reset',
        description: 'Backups, moving your data to or from another machine, and resetting settings.',
        keywords: 'backup restore import export reset migrate',
        subsections: [
          { id: 'backups', label: 'Backups' },
          { id: 'import', label: 'Import and export' },
          { id: 'reset', label: 'Reset' },
        ],
      },
    ],
  },
  {
    label: 'Install',
    pages: [
      {
        id: 'install',
        label: 'Tools and installs',
        description: 'Every program, skill and MCP server Foreman uses: where it is, and a button to install it, look for it or point Foreman at it.',
        keywords: 'install setup location path locate find uv opencode playwright superpowers skills mcp servers dictation claude winget npm',
        subsections: [
          { id: 'install', label: 'Programs' },
          { id: 'superpowers', label: 'Skills' },
          { id: 'mcp', label: 'MCP servers' },
        ],
      },
    ],
  },
]

export const SETTINGS_PAGES: SettingsPage[] = SETTINGS_CATEGORIES.flatMap((c) => c.pages)

// The page and (when the id names a section inside a shared page) the section to scroll to.
// Page ids win over section ids, so 'general' opens the General page itself.
export function resolveSettingsTarget(id?: string): { page: SettingsPage; section?: SettingsSubsection } | undefined {
  if (!id) return undefined
  const page = SETTINGS_PAGES.find((p) => p.id === id)
  if (page) return { page }
  for (const p of SETTINGS_PAGES) {
    const section = p.subsections.find((s) => s.id === id)
    if (section) return { page: p, section }
  }
  return undefined
}

// The page list a search matches against: the page's label, description, keywords and section labels.
export function settingsSearchText(page: SettingsPage): string {
  return [page.label, page.description, page.keywords ?? '', ...page.subsections.map((s) => s.label)].join(' ').toLowerCase()
}
