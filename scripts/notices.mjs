// Writes out/licenses: Foreman's own LICENSE and THIRD_PARTY_NOTICES.txt with the license text of every package the
// app ships, bundled or not. The packages are the runtime dependencies and the ones the source
// imports, plus everything they depend on.
// Electron's and Chromium's licenses are added by electron-builder itself.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = join(root, 'out', 'licenses')
const SOURCE_DIRS = ['core', 'main', 'shared', 'cli', 'renderer/src']
const SKIP = new Set(['electron', ...builtinModules])

const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })

const packageOf = (spec) => {
  if (/^(\.|\/|node:|@\/|@shared\/|@core\/|virtual:)/.test(spec)) return null
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return SKIP.has(name) ? null : name
}

// Runtime dependencies ship in node_modules as they are, whether or not the source names them literally.
const roots = new Set(Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {}))
for (const dir of SOURCE_DIRS) {
  for (const f of files(join(root, dir))) {
    // Type-only imports ship nothing.
    const text = readFileSync(f, 'utf8').replace(/^\s*import\s+type\s[\s\S]*?\bfrom\s+['"][^'"]+['"]/gm, '')
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|@import\s+)['"]([^'"]+)['"]/g)) {
      const name = packageOf(m[1])
      if (name) roots.add(name)
    }
  }
}

// npm may nest a package under the one that needs it: look from there up to the root.
const find = (name, fromDir) => {
  for (let d = fromDir; ; d = dirname(d)) {
    const p = join(d, 'node_modules', name)
    if (existsSync(join(p, 'package.json'))) return p
    if (d === root || dirname(d) === d) return null
  }
}

const seen = new Map()
const visit = (name, fromDir) => {
  const dir = find(name, fromDir)
  if (!dir || seen.has(dir)) return
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  seen.set(dir, pkg)
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, dir)
}
for (const name of roots) visit(name, root)

const licenseText = (dir, pkg) => {
  const texts = readdirSync(dir)
    .filter((n) => /^(licen[cs]e|copying|notice)/i.test(n) && statSync(join(dir, n)).isFile())
    .sort()
    .map((n) => readFileSync(join(dir, n), 'utf8').trim())
  if (texts.length) return texts.join('\n\n')
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see the package')
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  return `License: ${license}${author ? `\nAuthor: ${author}` : ''}\n(The package ships no license file.)`
}

const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const SHADCN = `shadcn/ui (components copied into renderer/src/components/ui)
MIT License

Copyright (c) 2023 shadcn

${MIT_TERMS}`

// The ideas behind the Engineering Mode skill pack (plugin/engineering, plugin/factory). The text is rewritten, not copied.
const ENGINEERING_CREDITS = [
  ['mattpocock/skills (ideas behind the Engineering Mode skills)', 'Copyright (c) 2026 Matt Pocock'],
  ['addyosmani/agent-skills (ideas behind the Engineering Mode skills)', 'Copyright (c) 2025 Addy Osmani'],
].map(([name, copyright]) => `${name}
MIT License

${copyright}

${MIT_TERMS}`)


const entries = [...seen.entries()]
  .map(([dir, pkg]) => ({ title: `${pkg.name} ${pkg.version}`, text: licenseText(dir, pkg) }))
  .sort((a, b) => a.title.localeCompare(b.title))
const rule = '\n\n' + '-'.repeat(78) + '\n\n'
const body = [
  'Foreman includes the third-party software listed below. Each part is under its own license, given in full.',
  'Electron and Chromium licenses are in LICENSE.electron.txt and LICENSES.chromium.html next to the app.',
  SHADCN,
  ...ENGINEERING_CREDITS,
  ...entries.map((e) => `${e.title}\n\n${e.text}`),
].join(rule)

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'THIRD_PARTY_NOTICES.txt'), body + '\n')
copyFileSync(join(root, 'LICENSE'), join(outDir, 'LICENSE.txt'))
console.log(`licenses: ${entries.length} packages from ${roots.size} imports -> ${outDir}`)
