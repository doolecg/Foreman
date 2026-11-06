// Bundles scripts/tickets-cli.ts (with core/tickets.ts, core/scheduler.ts, core/test-lock.ts) into one dependency-free
// file the Orchestration kit ships: plugin/kit/foreman/tickets.mjs. Uses the vite that is already installed, so there is
// no extra dependency. Run by `npm run build`; pass an output folder to build somewhere else (the tests do).
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function buildTicketsCli(outDir = resolve(root, 'plugin/kit/foreman')) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      target: 'node24',
      minify: false,
      lib: { entry: resolve(root, 'scripts/tickets-cli.ts'), formats: ['es'], fileName: () => 'tickets.mjs' },
      rollupOptions: { external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)] },
    },
  })
  return resolve(outDir, 'tickets.mjs')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await buildTicketsCli(process.argv[2] ? resolve(process.argv[2]) : undefined))
}
