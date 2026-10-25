import {
  applyEvent,
  emptyQueue,
  queueItems,
  type LiveQueue,
  type QueueItem,
  type TaskDetail,
} from '@autopilot/contracts'
import { isDefinedError, ORPCError } from '@orpc/client'
import { execute, overlay, PENDING_PREFIX, type Command, type Conflict, type Pending } from './commands.ts'
import { Link, Offline, timeoutSignal, type Api, type Connection, type PinnedFetch } from './connection.ts'

/** Key-value storage that survives the app being closed: expo-sqlite's kv-store on the phone. */
export type Storage = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export const memoryStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

export type Status = 'connecting' | 'online' | 'offline'

export type SyncState = {
  status: Status
  routeKind: 'lan' | 'tailscale' | null
  lastSyncedAt: string | null
  queue: LiveQueue
  outbox: Pending[]
  conflicts: Conflict[]
}

export type SyncOptions = {
  connection: Connection
  pinned: PinnedFetch
  storage: Storage
  now?: () => Date
  /** Idempotency keys; the phone passes expo-crypto's, as Hermes has no global crypto. */
  newKey?: () => string
  /** Tasks that came to the owner's turn since the last sync, for a local notification. */
  onYourTurn?: (items: QueueItem[]) => void
  /** How long a catch-up holds the call open when nothing is new. */
  waitSeconds?: number
}

/**
 * The phone's copy of the queue: a cached snapshot kept current from the change feed, and an
 * outbox of commands applied to the screen at once and sent in order when a route answers.
 */
export class Sync {
  private readonly o: Required<Omit<SyncOptions, 'onYourTurn'>> & Pick<SyncOptions, 'onYourTurn'>
  private readonly link: Link
  private state: SyncState = { status: 'connecting', routeKind: null, lastSyncedAt: null, queue: emptyQueue, outbox: [], conflicts: [] }
  private readonly listeners = new Set<() => void>()
  private running = false
  /** Each start gets a number; a loop from before a stop ends instead of running beside the new one. */
  private generation = 0
  private wake: (() => void) | null = null
  private flushing: Promise<void> | null = null

  constructor(options: SyncOptions) {
    this.o = { now: () => new Date(), newKey: () => crypto.randomUUID(), waitSeconds: 20, ...options }
    this.link = new Link(options.connection, options.pinned)
  }

  // ── state ──

  getState = (): SyncState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: Partial<SyncState>): void {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    const read = async <T>(key: string, fallback: T): Promise<T> => {
      const text = await this.o.storage.get(key)
      return text ? (JSON.parse(text) as T) : fallback
    }
    this.set({
      queue: await read('queue', emptyQueue),
      outbox: await read('outbox', []),
      conflicts: await read('conflicts', []),
      lastSyncedAt: await read('lastSyncedAt', null),
    })
  }

  private async save(): Promise<void> {
    await Promise.all([
      this.o.storage.set('queue', JSON.stringify(this.state.queue)),
      this.o.storage.set('outbox', JSON.stringify(this.state.outbox)),
      this.o.storage.set('conflicts', JSON.stringify(this.state.conflicts)),
      this.o.storage.set('lastSyncedAt', JSON.stringify(this.state.lastSyncedAt)),
    ])
  }

  /** The queue as the screen shows it: the server's, with what is still in the outbox applied on top. */
  items(now = this.o.now()): QueueItem[] {
    return queueItems(overlay(this.state.queue, this.state.outbox, now), now)
  }

  /** Commands for one task that have not reached the server yet, for the conversation. */
  pendingFor(taskId: string): Pending[] {
    return this.state.outbox.filter((p) => 'taskId' in p.command && p.command.taskId === taskId)
  }

  // ── commands ──

  async send(command: Command): Promise<void> {
    const n = (this.state.outbox.at(-1)?.n ?? 0) + 1
    this.set({ outbox: [...this.state.outbox, { id: this.o.newKey(), n, at: this.o.now().toISOString(), command }] })
    await this.save()
    this.kick()
  }

  /** Sends the outbox in order; stops at the first item the network fails on. */
  flush(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async flushOnce(): Promise<void> {
    for (;;) {
      const next = this.state.outbox[0]
      if (!next) return
      try {
        await execute(this.link.api, next)
      } catch (error) {
        // The network failed, or the server did: keep it and try again next round.
        if (!(error instanceof ORPCError) || error.status >= 500) throw error
        const reason = isDefinedError(error) && error.code === 'CONFLICT' ? (error.data.reason === 'already_answered' ? 'already_answered' : 'task_closed') : 'rejected'
        this.set({ conflicts: [...this.state.conflicts, { id: next.id, command: next.command, reason, message: error.message }] })
      }
      this.set({ outbox: this.state.outbox.filter((p) => p.id !== next.id) })
      await this.save()
    }
  }

  dismissConflict(id: string): void {
    this.set({ conflicts: this.state.conflicts.filter((c) => c.id !== id) })
    void this.save()
  }

  // ── catching up ──

  /** One round: find a route, send the outbox, and catch up on the change feed. */
  async syncOnce(waitSeconds = 0): Promise<void> {
    try {
      if (!this.link.route()) {
        this.set({ status: 'connecting' })
        const route = await this.link.probe()
        if (!route) throw new Error('offline')
        this.set({ routeKind: route.kind === 'socket' ? null : route.kind })
      }
      await this.flush()
      await this.catchUp(waitSeconds)
      this.set({ status: 'online', lastSyncedAt: this.o.now().toISOString() })
      await this.save()
    } catch {
      // No route, or a call failed on the way: the next round probes the routes again.
      this.link.lost()
      this.set({ status: 'offline', routeKind: null })
    }
  }

  private async catchUp(waitSeconds: number): Promise<void> {
    const before = new Set(this.items().filter((i) => i.band === 'your_turn').map((i) => i.task.id))
    // Never synced: start from a snapshot; afterwards only the changes since.
    const first = this.state.lastSyncedAt === null
    let queue = this.state.queue
    if (first) {
      queue = applyEvent(queue, { type: 'snapshot', snapshot: await this.link.api.queue.list({}) })
    } else {
      for (let wait = waitSeconds; ; wait = 0) {
        const page = await this.link.api.changes.since(
          { after: queue.seq, wait },
          { signal: timeoutSignal((wait + 15) * 1000) },
        )
        for (const change of page.changes) queue = applyEvent(queue, change)
        if (!page.more) break
      }
    }
    this.set({ queue })
    if (!first && this.o.onYourTurn) {
      const fresh = this.items().filter((i) => i.band === 'your_turn' && !before.has(i.task.id))
      if (fresh.length > 0) this.o.onYourTurn(fresh)
    }
  }

  /** A read that only makes sense online (signals, devices): throws `Offline` when no route answers. */
  async online<T>(read: (api: Api) => Promise<T>): Promise<T> {
    if (!this.link.route() && !(await this.link.probe())) throw new Offline()
    try {
      return await read(this.link.api)
    } catch (error) {
      if (!(error instanceof ORPCError)) this.link.lost()
      throw error
    }
  }

  /** A task with its conversation; the cached copy when the server is out of reach. */
  async detail(taskId: string): Promise<TaskDetail | null> {
    if (taskId.startsWith(PENDING_PREFIX)) return null
    try {
      if (!this.link.route() && !(await this.link.probe())) throw new Error('offline')
      const detail = await this.link.api.tasks.get({ id: taskId }, { signal: timeoutSignal(10_000) })
      await this.o.storage.set(`task:${taskId}`, JSON.stringify(detail))
      return detail
    } catch {
      const cached = await this.o.storage.get(`task:${taskId}`)
      return cached ? (JSON.parse(cached) as TaskDetail) : null
    }
  }

  // ── the loop ──

  /** Keeps syncing while the app is in front: long polls when online, retries every few seconds when not. */
  start(): void {
    if (this.running) return
    this.running = true
    const generation = ++this.generation
    void (async () => {
      while (this.running && this.generation === generation) {
        await this.syncOnce(this.state.status === 'online' ? this.o.waitSeconds : 0)
        if (this.state.status !== 'online') await this.pause(5_000)
      }
    })()
  }

  stop(): void {
    this.running = false
    this.kick()
  }

  /** Something happened (a command, the app came to the front, the network changed): sync now. */
  kick(): void {
    this.wake?.()
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        clearTimeout(timer)
        this.wake = null
        resolve()
      }
      timer = setTimeout(done, ms)
      this.wake = done
    })
  }
}

