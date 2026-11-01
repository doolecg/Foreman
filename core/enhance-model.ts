import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeAdapter, MODEL_TIMEOUT_MS, resultWithin, type MasterAdapter } from './model-run'

// The cheap Claude model that rewrites rough composer text (Chat view "Enhance prompt"). One call, no tools, no project files.
export const ENHANCE_MODEL = 'claude-haiku-5-5'

export type EnhanceModel = (prompt: string) => Promise<string>

export function claudeEnhanceModel(supported?: ReadonlySet<string>, adapter?: MasterAdapter): EnhanceModel {
  const claude = adapter ?? new ClaudeAdapter({ supported, permissionMode: 'default' })
  return async (prompt) => {
    const cwd = join(tmpdir(), 'foreman-enhance')
    mkdirSync(cwd, { recursive: true })
    const run = await claude.start({ cwd, prompt, model: ENHANCE_MODEL, onEvent: () => undefined })
    const result = await resultWithin(run, MODEL_TIMEOUT_MS, 'The prompt enhancer')
    if (!result.ok) throw new Error(result.text || 'The prompt enhancer failed')
    return result.text
  }
}
