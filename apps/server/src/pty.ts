import { chmodSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { SpawnPty } from './launcher.ts'

/**
 * node-pty starts processes on macOS through a small `spawn-helper` binary. Package managers can
 * unpack its prebuilt copy without the execute bit, and every spawn then fails with
 * "posix_spawnp failed". Restore the bit before the first session.
 */
export const ensureSpawnHelper = (): void => {
  if (process.platform !== 'darwin') return
  const root = dirname(dirname(createRequire(import.meta.url).resolve('node-pty')))
  const candidates = [
    join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'),
    join(root, 'build', 'Release', 'spawn-helper'),
  ]
  for (const file of candidates) {
    if (existsSync(file) && (statSync(file).mode & 0o111) === 0) chmodSync(file, 0o755)
  }
}

/** node-pty is native; it is loaded only when a session actually starts. */
export const loadPty = async (): Promise<SpawnPty> => {
  ensureSpawnHelper()
  const pty = await import('node-pty')
  return (file, args, options) => pty.spawn(file, args, { name: 'xterm-256color', ...options })
}
