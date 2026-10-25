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
import { loadPty } from './pty.ts'
import { ensureDataDir, ensureOwnerToken } from './owner.ts'
import type { Paths } from './paths.ts'
import { Service } from './service.ts'
import { claudeHeadless, Signals, type RunClaude } from './signals.ts'
import { Watchers } from './watchers.ts'

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

/** Used when node-pty cannot be loaded at all: every session start fails with this reason. */
const missingPty: SpawnPty = () => {
  throw new Error('node-pty could not be loaded; run pnpm install again')
}

export const startServer = async (options: ServerOptions): Promise<ServerHandle> => {
  const { paths } = options
  const log = options.log ?? ((message: string) => console.log(`${new Date().toISOString()} ${message}`))
  ensureDataDir(paths)
  // The contract caps ids at 64 characters; macOS hostnames can be longer.
  const machineId = hostname().split('.')[0]?.slice(0, 64) || 'local'
  const service = new Service({ db: openDatabase(paths.db), machineId })
  chmodSync(paths.db, 0o600)
  ensureOwnerToken(paths, service)

  const workstreams = () => readWorkstreams(paths.home)
  const spawn = options.spawn ?? (await loadPty().catch(() => missingPty))
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

  const runClaude = options.runClaude ?? claudeHeadless(options.claude ?? 'claude')
  const prompts = join(ROOT, 'prompts')
  const owner = options.owner ?? 'the owner'
  const signals = new Signals({ service, paths, workstreams, runClaude, prompts, owner, self: options.self, log })
  const watchers = new Watchers({ service, paths, workstreams, runClaude, prompts, owner, log })

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
    log,
  })
  const server: Server = await listen(router, service, paths.socket)

  // Side effects run after each commit and on a timer, so a deferred delivery is retried.
  const drain = () => void launcher.drain().catch((error: unknown) => log(`outbox: ${String(error)}`))
  const unsubscribe = service.onChange(drain)
  const outbox = setInterval(drain, 2000)
  // Signals and watchers each run one at a time, but beside each other.
  const tick = setInterval(() => {
    void signals.tick()
    void watchers.tick()
  }, 30_000)
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
