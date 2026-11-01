// What the "Start new project" setup shows and returns. The catalog itself stays in core.
export interface SetupItemView {
  kind: 'agents' | 'mcp' | 'skills' | 'plugins'
  name: string
  // Why it was suggested: "preset web" or "mentions blender".
  why: string
  // The catalog's one-line "needed when".
  needed: string
}

export interface SetupPlanView {
  preset: string
  // Every preset in the catalog, for the picker.
  presets: string[]
  items: SetupItemView[]
}

export interface SetupApplyResult {
  written: string[]
  skipped: string[]
  needsRestart: boolean
}
