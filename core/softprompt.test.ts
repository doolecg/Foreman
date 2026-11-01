import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSoftPrompt, promptShellOf } from './softprompt'

const base = { dataDir: '/data/Op erant', home: '/home/me' }
const file = (r: ReturnType<typeof buildSoftPrompt>, name: string): string => r?.files.find((f) => f.path.endsWith(name))?.content ?? ''

describe('promptShellOf', () => {
  it('knows PowerShell, bash and zsh by file name', () => {
    expect(promptShellOf('powershell.exe')).toBe('powershell')
    expect(promptShellOf('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
    expect(promptShellOf('/bin/bash')).toBe('bash')
    expect(promptShellOf('/bin/zsh')).toBe('zsh')
  })
  it('leaves cmd, fish and others alone', () => {
    expect(promptShellOf('cmd.exe')).toBeNull()
    expect(promptShellOf('/usr/bin/fish')).toBeNull()
    expect(buildSoftPrompt({ ...base, shell: { file: 'cmd.exe', args: [] } })).toBeNull()
    expect(buildSoftPrompt({ ...base, shell: { file: '/usr/bin/fish', args: ['-l'] } })).toBeNull()
  })
})

describe('PowerShell', () => {
  const r = buildSoftPrompt({ ...base, shell: { file: 'powershell.exe', args: ['-NoLogo'] } })
  const script = file(r, 'soft-prompt.ps1')
  it('runs the script text inline so the profile loads first and the execution policy is not hit', () => {
    expect(r?.spec.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command'])
    expect(r?.spec.args).not.toContain('-NoProfile')
    const cmd = r?.spec.args[3] ?? ''
    expect(cmd).toContain(`ReadAllText('${join(base.dataDir, 'shell', 'soft-prompt.ps1')}'`)
    expect(cmd.startsWith('Invoke-Expression')).toBe(true)
  })
  it('doubles quotes in the script path', () => {
    const q = buildSoftPrompt({ dataDir: "/d/it's", home: '/h', shell: { file: 'pwsh', args: [] } })
    expect(q?.spec.args[3]).toContain("it''s")
  })
  it('defines the prompt with exit colour, duration and git logic, ASCII only', () => {
    expect(script).toContain('function global:prompt')
    expect(script.startsWith('# Foreman soft prompt')).toBe(true)
    expect(script.indexOf('$ok = $?')).toBeLessThan(script.indexOf('Get-History'))
    expect(script).toContain('-ForegroundColor Green } else { Write-Host $chev -NoNewline -ForegroundColor Red')
    expect(script).toContain('-ge 3)')
    expect(script).toContain('git rev-parse --abbrev-ref HEAD')
    expect(script).toContain('git status --porcelain')
    expect(script).toContain('$global:LASTEXITCODE = $exitCode')
    expect(/^[\x00-\x7f]*$/.test(script)).toBe(true)
    expect(script).not.toContain('§')
  })
})

describe('bash', () => {
  const r = buildSoftPrompt({ ...base, shell: { file: '/bin/bash', args: ['-l'] } })
  const script = file(r, 'soft-prompt.bashrc')
  it('uses --rcfile and loads the user profile and .bashrc first', () => {
    expect(r?.spec.args).toEqual(['--rcfile', join(base.dataDir, 'shell', 'soft-prompt.bashrc'), '-i'])
    expect(script.indexOf('.bash_profile')).toBeLessThan(script.indexOf('PS1='))
    expect(script).toContain('.bashrc')
  })
  it('wraps every escape in \\[ \\] and keeps $ for variables only', () => {
    const ps1 = script.split('\n').find((l) => l.startsWith('PS1='))!
    const escapes = ps1.match(/\\e\[[0-9;${}\w]*m/g) ?? []
    expect(escapes.length).toBeGreaterThan(8)
    expect(ps1.match(/\\\[\\e\[[^\]]*\\\]/g)?.length).toBe(escapes.length)
    expect((ps1.match(/\$/g) ?? []).length).toBe((ps1.match(/\$\{__op_\w+\}/g) ?? []).length)
    expect(ps1).toContain('38;5;${__op_cc}m')
  })
  it('colours the arrow by exit status and shows slow commands', () => {
    expect(script).toContain('local st=$?')
    expect(script).toContain('__op_cc=174')
    expect(script).toContain('-ge 3 ]')
    expect(script).toContain('git rev-parse --abbrev-ref HEAD')
    expect(script).toContain('timeout 2')
    expect(script).not.toContain('§')
  })
})

describe('zsh', () => {
  const r = buildSoftPrompt({ ...base, shell: { file: '/bin/zsh', args: ['-l'] } })
  it('points ZDOTDIR at Foreman stubs that load the user files first', () => {
    expect(r?.spec).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(r?.env.ZDOTDIR).toBe(join(base.dataDir, 'shell', 'zsh'))
    expect(file(r, '.zshenv')).toContain(`ZDOTDIR='/home/me'`)
    expect(file(r, '.zprofile')).toContain('.zprofile')
    const rc = file(r, '.zshrc')
    expect(rc.indexOf('source "$ZDOTDIR/.zshrc"')).toBeLessThan(rc.indexOf('PROMPT='))
  })
  it('uses the user ZDOTDIR and quotes it', () => {
    const q = buildSoftPrompt({ ...base, zdotdir: "/x/it's", shell: { file: '/bin/zsh', args: [] } })
    expect(file(q, '.zshenv')).toContain(`'/x/it'\\''s'`)
  })
  it('sets the prompt through hooks, escapes % and colours the arrow by status', () => {
    const rc = file(r, '.zshrc')
    expect(rc).toContain('precmd_functions=(__op_precmd')
    expect(rc).toContain('preexec_functions=(__op_preexec')
    expect(rc).toContain('local st=$?')
    expect(rc).toContain('__op_cc=174')
    expect(rc).toContain('%F{${__op_cc}}❯%f')
    expect(rc).toContain('//\\%/%%')
    expect(rc).toContain('t >= 3 ')
    expect(rc).not.toContain('§')
  })
})
