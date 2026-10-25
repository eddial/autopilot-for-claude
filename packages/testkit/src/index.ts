import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Invite } from '@autopilot/contracts'
import { connect, type Client } from '@autopilot/server/client'
import type { SpawnPty } from '@autopilot/server/launcher'
import { startServer, type ServerHandle, type ServerOptions } from '@autopilot/server/main'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths, type Paths } from '@autopilot/server/paths'

/**
 * What tests that need a real server share: a throwaway data folder, a server with no Claude Code
 * behind it, and the owner's client. Sessions start but nothing runs; a test plays the session
 * through `service`.
 */

/** A terminal that accepts everything and does nothing. */
export const quietPty: SpawnPty = () => ({ pid: 1, write: () => {}, kill: () => {}, onData: () => {}, onExit: () => {} })

/** Idempotency keys, unique within a test file. */
export const keys = (prefix: string): (() => string) => {
  let n = 0
  return () => `${prefix}-${++n}-key`
}

export type TestServer = {
  handle: ServerHandle
  service: ServerHandle['service']
  paths: Paths
  dir: string
  owner: Client
  close(): Promise<void>
}

export type TestServerOptions = Partial<Omit<ServerOptions, 'paths'>> & {
  /** Workstream files to write before the server starts, by name: `{ engineering: '## Routing…' }`. */
  workstreams?: Record<string, string>
  /** Start on the data of an earlier test server (a restart). */
  paths?: Paths
}

export const startTestServer = async (options: TestServerOptions = {}): Promise<TestServer> => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-test-'))
  const paths = options.paths ?? resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  for (const [name, text] of Object.entries(options.workstreams ?? {})) {
    mkdirSync(join(paths.home, 'workstreams'), { recursive: true })
    writeFileSync(join(paths.home, 'workstreams', `${name}.md`), text)
  }
  const { workstreams: _workstreams, paths: _paths, ...rest } = options
  const handle = await startServer({
    paths,
    self: { node: process.execPath, script: 'autopilot.js' },
    // Set-up checks for Claude Code; here it is never installed.
    claude: join(dir, 'no-claude'),
    runClaude: () => Promise.resolve({ items: [] }),
    spawn: quietPty,
    devicePort: 0,
    log: () => {},
    ...rest,
  })
  return {
    handle,
    service: handle.service,
    paths,
    dir,
    owner: connect(paths.socket, readOwnerToken(paths) ?? ''),
    close: () => handle.close(),
  }
}

/** A pairing invite as the Mac app shows it, with this machine's loopback first so tests never wait on mDNS. */
export const localInvite = async (server: TestServer, key: string): Promise<Invite> => {
  const { invite } = await server.owner.devices.startPairing({ idempotencyKey: key })
  return { ...invite, routes: [{ kind: 'lan', address: `127.0.0.1:${server.handle.devicePort() ?? 0}` }, ...invite.routes] }
}
