import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { build as esbuild, type BuildOptions } from 'esbuild'
import { build as vite, createServer } from 'vite'

/**
 * Builds the main process and preload with esbuild and the window with Vite into dist/.
 * `--dev` serves the window from Vite with hot reload and starts Electron on it.
 */
const ROOT = join(import.meta.dirname, '..')
const dev = process.argv.includes('--dev')

const shared: BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
}
// Bundled CommonJS dependencies (undici) call require(); an ES module has none of its own.
const requireShim = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
await esbuild({
  ...shared,
  entryPoints: [join(ROOT, 'electron', 'main.ts')],
  outfile: join(ROOT, 'dist', 'electron', 'main.js'),
  format: 'esm',
  banner: { js: requireShim },
})
// Sandboxed preloads must be CommonJS.
await esbuild({
  ...shared,
  entryPoints: [join(ROOT, 'electron', 'preload.ts')],
  outfile: join(ROOT, 'dist', 'electron', 'preload.cjs'),
  format: 'cjs',
})

if (dev) {
  const server = await createServer({ configFile: join(ROOT, 'vite.config.ts') })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/'
  const electron = (await import('electron')).default as unknown as string
  const child = spawn(electron, [ROOT], { stdio: 'inherit', env: { ...process.env, AUTOPILOT_DEV_URL: url } })
  child.on('exit', () => void server.close().then(() => process.exit(0)))
} else {
  await vite({ configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn' })
}
