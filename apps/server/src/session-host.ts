import { spawn as spawnProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import type { Pty, SpawnPty } from './launcher.ts'
import { loadPty } from './pty.ts'

/**
 * Sessions outlive the server. The terminals Claude Code runs in belong to this small process,
 * which almost never restarts; the server asks it to start a session, reads its screen and types
 * into it over a local socket, and after a restart reattaches to what is still running. So
 * restarting or updating the server no longer stops a session, and its Remote Control link stays
 * live. Lines of JSON each way.
 */
type Request =
  | { op: 'spawn'; key: string; file: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
  | { op: 'write'; key: string; data: string }
  | { op: 'kill'; key: string; signal?: string }
  | { op: 'list' }

type Event =
  | { type: 'spawned'; key: string; pid: number }
  | { type: 'failed'; key: string; message: string }
  | { type: 'data'; key: string; data: string }
  | { type: 'exit'; key: string; exitCode: number }
  | { type: 'sessions'; running: { key: string; pid: number; output: string }[]; exited: { key: string; exitCode: number }[] }

/** What a reattaching server needs to read where the screen is: the last of it. */
const KEEP = 20_000

/** Reads lines of JSON from a socket. */
const lines = <T>(socket: Socket, each: (message: T) => void) => {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let end = buffer.indexOf('\n')
    while (end >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      if (line) each(JSON.parse(line) as T)
      end = buffer.indexOf('\n')
    }
  })
}

const send = (socket: Socket, message: Request | Event) => {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
}

/** The host itself: `autopilot session-host`. Runs until stopped; stopping it ends its sessions. */
export const runSessionHost = async (socketPath: string, spawn?: SpawnPty): Promise<{ close: () => Promise<void> }> => {
  const start = spawn ?? (await loadPty())
  const sessions = new Map<string, { pty: Pty; output: string }>()
  // Ended while no server was listening: told to the next one that asks.
  const exited = new Map<string, number>()
  const clients = new Set<Socket>()
  const tell = (event: Event) => {
    for (const client of clients) send(client, event)
  }

  if (existsSync(socketPath)) rmSync(socketPath)
  const server = createServer((socket) => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
    lines<Request>(socket, (request) => {
      switch (request.op) {
        case 'spawn': {
          try {
            const pty = start(request.file, request.args, {
              cwd: request.cwd,
              env: request.env,
              cols: request.cols,
              rows: request.rows,
            })
            const session = { pty, output: '' }
            sessions.set(request.key, session)
            pty.onData((data) => {
              session.output = (session.output + data).slice(-KEEP)
              tell({ type: 'data', key: request.key, data })
            })
            pty.onExit(({ exitCode }) => {
              sessions.delete(request.key)
              if (clients.size === 0) exited.set(request.key, exitCode)
              tell({ type: 'exit', key: request.key, exitCode })
            })
            send(socket, { type: 'spawned', key: request.key, pid: pty.pid })
          } catch (error) {
            send(socket, { type: 'failed', key: request.key, message: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        case 'write':
          sessions.get(request.key)?.pty.write(request.data)
          return
        case 'kill':
          sessions.get(request.key)?.pty.kill(request.signal)
          return
        case 'list':
          send(socket, {
            type: 'sessions',
            running: [...sessions].map(([key, s]) => ({ key, pid: s.pty.pid, output: s.output })),
            exited: [...exited].map(([key, exitCode]) => ({ key, exitCode })),
          })
          exited.clear()
          return
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  return {
    close: async () => {
      for (const { pty } of sessions.values()) pty.kill()
      for (const client of clients) client.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** A session as the launcher sees it, with what was on its screen when the server reattached. */
export type Hosted = { key: string; pty: Pty; output: string }

/** The server's side: a `spawn` for the launcher, and the sessions still running after a restart. */
export type HostClient = {
  spawn: SpawnPty
  /** Sessions the host still runs, and those that ended while no server was listening. */
  attach: () => Promise<{ running: Hosted[]; exited: { key: string; exitCode: number }[] }>
  /** Lets go without ending anything: the sessions keep running for the next server. */
  close: () => void
}

/**
 * Connects to the host at `socketPath`, starting one (detached, so it outlives this process) when
 * none answers: how a server run by hand gets one. Installed as a service, launchd keeps it running.
 */
export const connectSessionHost = async (socketPath: string, startHost: (() => void) | null): Promise<HostClient> => {
  const connect = () =>
    new Promise<Socket>((resolve, reject) => {
      const socket = createConnection(socketPath)
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    })
  let socket: Socket
  try {
    socket = await connect()
  } catch (error) {
    if (!startHost) throw error
    startHost()
    socket = await (async () => {
      for (let i = 0; ; i++) {
        try {
          return await connect()
        } catch (failed) {
          if (i >= 50) throw failed
          await new Promise((r) => setTimeout(r, 100))
        }
      }
    })()
  }

  const listeners = new Map<string, { data: ((data: string) => void)[]; exit: ((e: { exitCode: number }) => void)[] }>()
  const waiting = new Map<string, (event: Event) => void>()
  let listing: ((event: Extract<Event, { type: 'sessions' }>) => void) | null = null
  lines<Event>(socket, (event) => {
    if (event.type === 'sessions') return listing?.(event)
    if (event.type === 'spawned' || event.type === 'failed') return waiting.get(event.key)?.(event)
    const own = listeners.get(event.key)
    if (event.type === 'data') for (const f of own?.data ?? []) f(event.data)
    else {
      for (const f of own?.exit ?? []) f({ exitCode: event.exitCode })
      listeners.delete(event.key)
    }
  })

  // A session through the host, with the pid it reported; events reach it from the moment it exists.
  const remote = (key: string, pid: number): Pty => {
    const own = { data: [] as ((data: string) => void)[], exit: [] as ((e: { exitCode: number }) => void)[] }
    listeners.set(key, own)
    return {
      pid,
      write: (data) => send(socket, { op: 'write', key, data }),
      kill: (signal) => send(socket, { op: 'kill', key, ...(signal ? { signal } : {}) }),
      onData: (f) => void own.data.push(f),
      onExit: (f) => void own.exit.push(f),
    }
  }

  return {
    spawn: (file, args, { key = randomUUID(), ...options }) => {
      // Listening before it starts, so not a byte of its screen is missed.
      const pty = remote(key, 0)
      send(socket, { op: 'spawn', key, file, args, ...options })
      void new Promise<Event>((resolve) => waiting.set(key, resolve)).then((event) => {
        waiting.delete(key)
        if (event.type === 'spawned') pty.pid = event.pid
        else {
          for (const f of listeners.get(key)?.exit ?? []) f({ exitCode: 127 })
          listeners.delete(key)
        }
      })
      return pty
    },
    attach: async () => {
      const event = await new Promise<Extract<Event, { type: 'sessions' }>>((resolve) => {
        listing = resolve
        send(socket, { op: 'list' })
      })
      listing = null
      return { running: event.running.map((s) => ({ key: s.key, pty: remote(s.key, s.pid), output: s.output })), exited: event.exited }
    },
    close: () => socket.end(),
  }
}

/** Starts `autopilot session-host` in the background, on its own, so it outlives the server that started it. */
export const startHostProcess = (self: { node: string; script: string }, env: NodeJS.ProcessEnv) => () => {
  spawnProcess(self.node, [self.script, 'session-host'], { detached: true, stdio: 'ignore', env }).unref()
}
