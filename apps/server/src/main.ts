import { chmodSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import type { Machine } from '@autopilot/contracts'
import { createRouter } from './api.ts'
import { openDatabase } from './db.ts'
import { readWorkstreams } from './home.ts'
import { listen } from './http.ts'
import { Launcher, type SpawnPty } from './launcher.ts'
import { ensureDataDir, ensureOwnerToken } from './owner.ts'
import type { Paths } from './paths.ts'
import { Service } from './service.ts'
import { claudeHeadless, Signals, type RunClaude } from './signals.ts'

/** The repository root, for `prompts/` and `plugin/`. */
export const ROOT = join(import.meta.dirname, '..', '..', '..')

export type ServerOptions = {
  paths: Paths
  /** How to run `autopilot` itself (for MCP configs and hooks). */
  self: { node: string; script: string }
  owner?: string
  claude?: string
  spawn?: SpawnPty
  runClaude?: RunClaude
  maxParallel?: number
  log?: (message: string) => void
}

export type ServerHandle = {
  service: Service
  launcher: Launcher
  signals: Signals
  close(): Promise<void>
}

/** node-pty is native; load it only when sessions are actually started. */
const nodePty: SpawnPty = (file, args, options) => {
  throw new Error(`node-pty not loaded (${file} ${args.length} args, ${options.cwd})`)
}

const loadPty = async (): Promise<SpawnPty> => {
  const pty = await import('node-pty')
  return (file, args, options) => pty.spawn(file, args, { name: 'xterm-256color', ...options })
}

export const startServer = async (options: ServerOptions): Promise<ServerHandle> => {
  const { paths } = options
  const log = options.log ?? ((message: string) => console.log(`${new Date().toISOString()} ${message}`))
  ensureDataDir(paths)
  const service = new Service({ db: openDatabase(paths.db), machineId: hostname() })
  chmodSync(paths.db, 0o600)
  ensureOwnerToken(paths, service)

  const workstreams = () => readWorkstreams(paths.home)
  const spawn = options.spawn ?? (await loadPty().catch(() => nodePty))
  const launcher = new Launcher({
    service,
    paths,
    workstreams,
    spawn,
    self: options.self,
    claude: options.claude ?? 'claude',
    pluginDir: join(ROOT, 'plugin'),
    maxParallel: options.maxParallel ?? 4,
    log,
  })
  launcher.reconcile()

  const signals = new Signals({
    service,
    paths,
    workstreams,
    runClaude: options.runClaude ?? claudeHeadless(options.claude ?? 'claude'),
    prompts: join(ROOT, 'prompts'),
    owner: options.owner ?? 'the owner',
    self: options.self,
    log,
  })

  const machine = (): Machine => ({
    id: service.machineId,
    name: hostname(),
    roles: ['main', 'runner'],
    capacity: options.maxParallel ?? 4,
    running: service.queue({ band: 'running' }).items.length,
    workstreams: workstreams().map((w) => w.name),
    routes: [{ kind: 'socket', address: paths.socket }],
    health: 'online',
    lastSeenAt: service.now().toISOString(),
  })

  const router = createRouter({
    service,
    workstreams,
    signals: {
      list: () => signals.list(),
      run: (name, dryMinutes) => signals.run(name, dryMinutes),
      pause: (name, paused) => signals.pause(name, paused),
    },
    machine,
  })
  const server: Server = await listen(router, service, paths.socket)

  // Side effects run after each commit and on a timer, so a deferred delivery is retried.
  const drain = () => void launcher.drain().catch((error: unknown) => log(`outbox: ${String(error)}`))
  const unsubscribe = service.onChange(drain)
  const outbox = setInterval(drain, 2000)
  const tick = setInterval(() => void signals.tick(), 30_000)
  drain()
  log(`listening on ${paths.socket}`)

  return {
    service,
    launcher,
    signals,
    close: async () => {
      clearInterval(outbox)
      clearInterval(tick)
      unsubscribe()
      launcher.stopAll()
      // Live subscriptions keep connections open; close them so shutdown does not wait on clients.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
      service.db.close()
    },
  }
}
