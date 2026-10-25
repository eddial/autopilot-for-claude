import { chmodSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import type { Machine } from '@autopilot/contracts'
import { createRouter } from './api.ts'
import { detect, keepFor } from './detect.ts'
import { openDatabase } from './db.ts'
import { readWorkstreams } from './home.ts'
import { listen } from './http.ts'
import { deviceRoutes, DEVICE_PORT, listenDevices } from './network.ts'
import { ensureCertificate } from './tls.ts'
import type { AddressInfo } from 'node:net'
import type { Server as HttpsServer } from 'node:https'
import { Launcher, type SpawnPty } from './launcher.ts'
import { loadPty } from './pty.ts'
import { ensureDataDir, ensureOwnerToken } from './owner.ts'
import type { Paths } from './paths.ts'
import { Service } from './service.ts'
import { claudeHeadless, Signals, type RunClaude } from './signals.ts'
import { Routing } from './routing.ts'
import { Scout } from './scout.ts'
import { installService } from './service-install.ts'
import { Setup } from './setup.ts'
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
  /** Claude Code's settings file, for trusting the launcher's folders; null leaves it alone. */
  claudeConfig?: string | null
  /** The HTTPS port for paired devices; 0 picks a free one (tests). */
  devicePort?: number
  log?: (message: string) => void
}

export type ServerHandle = {
  service: Service
  launcher: Launcher
  signals: Signals
  /** The device listener's port once it is open. */
  devicePort(): number | null
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
    // Tests run their own stand-in for Claude Code and leave ~/.claude.json alone.
    claudeConfig: options.claudeConfig !== undefined ? options.claudeConfig : options.spawn ? null : join(homedir(), '.claude.json'),
    maxParallel: options.maxParallel ?? 4,
    log,
  })
  launcher.reconcile()

  const runClaude = options.runClaude ?? claudeHeadless(options.claude ?? 'claude')
  const prompts = join(ROOT, 'prompts')
  const owner = options.owner ?? 'the owner'
  const signals = new Signals({ service, paths, workstreams, runClaude, prompts, owner, self: options.self, log })
  const watchers = new Watchers({ service, paths, workstreams, runClaude, prompts, owner, log })
  const routing = new Routing({ service, paths, runClaude, owner, log })
  const scout = new Scout({ service, paths, workstreams, runClaude, prompts, owner, log })

  const machine = (): Machine => ({
    id: service.machineId,
    name: hostname(),
    roles: ['main', 'runner'],
    capacity: options.maxParallel ?? 4,
    running: service.queue({ band: 'running' }).items.length,
    workstreams: workstreams().map((w) => w.name),
    routes: [{ kind: 'socket', address: paths.socket }, ...(devices ? deviceRoutes(openPort()) : [])],
    health: 'online',
    lastSeenAt: service.now().toISOString(),
  })

  // The listener for paired devices opens with the first pairing, and at start once any device is paired.
  let devices: HttpsServer | null = null
  const openPort = () => (devices?.address() as AddressInfo | null)?.port ?? 0
  const openDevices = async () => {
    devices ??= await listenDevices(router, service, ensureCertificate(paths), options.devicePort ?? DEVICE_PORT)
    return devices
  }

  const router = createRouter({
    service,
    workstreams,
    signals: {
      list: () => signals.list(),
      run: (name, dryMinutes) => signals.run(name, dryMinutes),
      importOpen: (name, dry) => signals.importOpen(name, dry),
      sweep: (names, days) => signals.sweep(names, days),
      pause: (name, paused) => signals.pause(name, paused),
    },
    machine,
    applyRouting: (changes) => routing.apply(changes),
    // Claude Code takes seconds to report its connectors, and they rarely change within minutes.
    detect: keepFor(5 * 60_000, () => detect(options.claude ?? 'claude')),
    setup: new Setup({ paths, examples: join(ROOT, 'examples', 'home'), claude: options.claude ?? 'claude' }),
    installService: () => void installService({ ...options.self, paths }),
    startPairing: async () => {
      await openDevices()
      const { code, expiresAt } = service.newPairingCode()
      const routes = deviceRoutes(openPort())
      return {
        invite: {
          v: 1 as const,
          server: hostname().split('.')[0] ?? 'Mac',
          routes: routes.length > 0 ? routes : [{ kind: 'lan' as const, address: `127.0.0.1:${openPort()}` }],
          fingerprint: ensureCertificate(paths).fingerprint,
          code,
        },
        expiresAt,
      }
    },
    log,
  })
  if (service.listDevices().length > 0) await openDevices()
  const server: Server = await listen(router, service, paths.socket)

  // Side effects run after each commit and on a timer, so a deferred delivery is retried.
  const drain = () => void launcher.drain().catch((error: unknown) => log(`outbox: ${String(error)}`))
  const unsubscribe = service.onChange(drain)
  const outbox = setInterval(drain, 2000)
  // Signals, watchers, routing and the scout each run one at a time, but beside each other.
  const tick = setInterval(() => {
    void signals.tick()
    void watchers.tick()
    void routing.tick()
    void scout.tick()
  }, 30_000)
  drain()
  log(`listening on ${paths.socket}`)

  return {
    service,
    launcher,
    signals,
    devicePort: () => (devices ? openPort() : null),
    close: async () => {
      clearInterval(outbox)
      clearInterval(tick)
      unsubscribe()
      launcher.stopAll()
      // Live subscriptions keep connections open; close them so shutdown does not wait on clients.
      const closing = [server, ...(devices ? [devices] : [])].map((s) => {
        const closed = new Promise<void>((resolve) => s.close(() => resolve()))
        s.closeAllConnections()
        return closed
      })
      await Promise.all(closing)
      service.db.close()
    },
  }
}
