import {
  API_VERSION,
  applyEvent,
  applyToDetail,
  emptyQueue,
  queueItems,
  type Change,
  type LiveQueue,
  type QueueItem,
  type TaskDetail,
} from '@autopilot/contracts'
import { isDefinedError, ORPCError } from '@orpc/client'
import { execute, overlay, PENDING_PREFIX, type Command, type Conflict, type Pending } from './commands.ts'
import { Link, Offline, timeoutSignal, type Api, type Connection, type PinnedFetch } from './connection.ts'
import { attentionKey } from './present.ts'

/** Key-value storage that survives the app being closed: expo-sqlite's kv-store on the phone. */
export type Storage = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  /** A synchronous read, where the storage has one: the first frame can then show the cache. */
  getSync?(key: string): string | null
}

export const memoryStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    getSync: (key) => values.get(key) ?? null,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

/** `unpaired`: the Mac answered, but no longer knows this device (it was removed under Servers). */
export type Status = 'connecting' | 'online' | 'offline' | 'unpaired'

export type SyncState = {
  status: Status
  routeKind: 'lan' | 'tailscale' | null
  lastSyncedAt: string | null
  /** Reaching for the Mac right now (a probe or a call on the way); offline stays offline meanwhile. */
  trying: boolean
  /** Offline: when the next try is due, backing off from 5 seconds to 30; a kick tries at once. */
  nextTryAt: string | null
  queue: LiveQueue
  outbox: Pending[]
  conflicts: Conflict[]
  /** Conversations fetched once and kept current from the feed, so a task opens without a request. */
  details: Record<string, TaskDetail>
}

export type SyncOptions = {
  connection: Connection
  pinned: PinnedFetch
  storage: Storage
  now?: () => Date
  /** Idempotency keys. No default: Hermes has no global crypto, so the phone passes expo-crypto's. */
  newKey: () => string
  /** Tasks that came to the owner's turn since the last sync, for a local notification. */
  onYourTurn?: (items: QueueItem[]) => void
  /** How long a catch-up holds the call open when nothing is new. */
  waitSeconds?: number
}

/** The cached queue, per API version: one cached under an older contract is not read, and a snapshot replaces it. */
const QUEUE = `queue.v${API_VERSION}`
const SYNCED = `lastSyncedAt.v${API_VERSION}`

/**
 * The phone's copy of the queue: a cached snapshot kept current from the change feed, and an
 * outbox of commands applied to the screen at once and sent in order when a route answers.
 */
export class Sync {
  private readonly o: Required<Omit<SyncOptions, 'onYourTurn'>> & Pick<SyncOptions, 'onYourTurn'>
  private readonly link: Link
  private state: SyncState = {
    status: 'connecting',
    routeKind: null,
    lastSyncedAt: null,
    trying: false,
    nextTryAt: null,
    queue: emptyQueue,
    outbox: [],
    conflicts: [],
    details: {},
  }
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** Rounds in a row that could not reach the Mac: how long to wait before the next. */
  private failures = 0
  /** Conversations being fetched, with the feed changes that arrived meanwhile (see `detail`). */
  private readonly fetching = new Map<string, Change[]>()
  /** Every ask that has been in your turn here: notified once, however often it comes and goes. */
  private readonly noticed = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private running = false
  /** Each start gets a number; a loop from before a stop ends instead of running beside the new one. */
  private generation = 0
  private wake: (() => void) | null = null
  private flushing: Promise<void> | null = null

  constructor(options: SyncOptions) {
    this.o = { now: () => new Date(), waitSeconds: 20, ...options }
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

  /** Reads the cache synchronously when the storage can, so the first frame shows the queue. */
  restore(): boolean {
    const getSync = this.o.storage.getSync
    if (!getSync) return false
    const read = <T>(key: string, fallback: T): T => {
      const text = getSync(key)
      return text ? (JSON.parse(text) as T) : fallback
    }
    this.set({
      queue: read(QUEUE, emptyQueue),
      outbox: read('outbox', []),
      conflicts: read('conflicts', []),
      lastSyncedAt: read(SYNCED, null),
    })
    return true
  }

  async load(): Promise<void> {
    const read = async <T>(key: string, fallback: T): Promise<T> => {
      const text = await this.o.storage.get(key)
      return text ? (JSON.parse(text) as T) : fallback
    }
    this.set({
      queue: await read(QUEUE, emptyQueue),
      outbox: await read('outbox', []),
      conflicts: await read('conflicts', []),
      lastSyncedAt: await read(SYNCED, null),
    })
  }

  /** The outbox and conflicts are small and must survive a crash: saved at once. */
  private async save(): Promise<void> {
    await Promise.all([
      this.o.storage.set('outbox', JSON.stringify(this.state.outbox)),
      this.o.storage.set('conflicts', JSON.stringify(this.state.conflicts)),
    ])
  }

  /** The queue is large and the server has it anyway: saved at most once a second, never on a tap. */
  private saveQueueSoon(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = null
      void Promise.all([
        this.o.storage.set(QUEUE, JSON.stringify(this.state.queue)),
        this.o.storage.set(SYNCED, JSON.stringify(this.state.lastSyncedAt)),
      ]).catch(() => {})
    }, 1000)
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
    // Straight away, beside any long poll in progress; a failure leaves it for the next round.
    if (this.link.route()) void this.flush().catch(() => {})
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
        const reason =
          isDefinedError(error) && error.code === 'CONFLICT'
            ? error.data.reason === 'already_answered'
              ? 'already_answered'
              : 'task_closed'
            : 'rejected'
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
        // Offline stays offline while it tries again, so the screen does not flicker each round.
        this.set({ status: this.state.status === 'offline' ? 'offline' : 'connecting', trying: true })
        const route = await this.link.probe()
        if (!route) throw new Error('offline')
        this.set({ routeKind: route.kind === 'socket' ? null : route.kind })
      }
      await this.flush()
      await this.catchUp(waitSeconds)
      this.failures = 0
      this.set({ status: 'online', trying: false, lastSyncedAt: this.o.now().toISOString() })
      this.saveQueueSoon()
    } catch (error) {
      // The Mac refused the token (the feed is always this device's to read, so a refusal means
      // it was removed): retrying will not help, pairing again will.
      if (error instanceof ORPCError && (error.status === 401 || error.status === 403)) {
        this.running = false
        this.set({ status: 'unpaired', routeKind: null, trying: false })
        return
      }
      // No route, or a call failed on the way: the next round probes the routes again.
      this.link.lost()
      this.failures++
      this.set({ status: 'offline', routeKind: null, trying: false })
    }
  }

  private async catchUp(waitSeconds: number): Promise<void> {
    for (const item of this.items()) if (item.band === 'your_turn') this.noticed.add(attentionKey(item))
    // Never synced: start from a snapshot; afterwards only the changes since.
    const first = this.state.lastSyncedAt === null
    let queue = this.state.queue
    let details = this.state.details
    if (first) {
      queue = applyEvent(queue, { type: 'snapshot', snapshot: await this.link.api.queue.list({}) })
    } else {
      for (let wait = waitSeconds; ; wait = 0) {
        const page = await this.link.api.changes.since({ after: queue.seq, wait }, { signal: timeoutSignal((wait + 15) * 1000) })
        // The Mac's history starts again lower than ours (its queue was wiped): start over from it.
        if (page.latest < queue.seq) {
          queue = applyEvent(queue, { type: 'snapshot', snapshot: await this.link.api.queue.list({}) })
          details = {}
          break
        }
        for (const change of page.changes) {
          queue = applyEvent(queue, change)
          for (const missed of this.fetching.values()) missed.push(change)
          if (Object.keys(details).length > 0)
            details = Object.fromEntries(Object.entries(details).map(([id, d]) => [id, applyToDetail(d, change)]))
        }
        if (!page.more) break
      }
    }
    this.set({ queue, details })
    if (!first && this.o.onYourTurn) {
      const fresh = this.items().filter((i) => i.band === 'your_turn' && !this.noticed.has(attentionKey(i)))
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

  /** The conversation the phone already has, without waiting: in memory, or saved from last time. */
  cachedDetail(taskId: string): TaskDetail | null {
    const kept = this.state.details[taskId]
    if (kept) return kept
    const saved = this.o.storage.getSync?.(`task:${taskId}`)
    return saved ? (JSON.parse(saved) as TaskDetail) : null
  }

  /** A task with its conversation, fetched and then kept current from the feed; the saved copy offline. */
  async detail(taskId: string): Promise<TaskDetail | null> {
    if (taskId.startsWith(PENDING_PREFIX)) return null
    if (this.state.details[taskId]) return this.state.details[taskId] ?? null
    if (this.fetching.has(taskId)) return this.cachedDetail(taskId)
    const missed: Change[] = []
    this.fetching.set(taskId, missed)
    try {
      if (!this.link.route() && !(await this.link.probe())) throw new Error('offline')
      // The feed may move on while this is in flight; what it brought meanwhile is applied on top.
      const detail = missed.reduce(applyToDetail, await this.link.api.tasks.get({ id: taskId }, { signal: timeoutSignal(10_000) }))
      this.set({ details: { ...this.state.details, [taskId]: detail } })
      void this.o.storage.set(`task:${taskId}`, JSON.stringify(detail)).catch(() => {})
      return detail
    } catch {
      const cached = await this.o.storage.get(`task:${taskId}`)
      return cached ? (JSON.parse(cached) as TaskDetail) : null
    } finally {
      this.fetching.delete(taskId)
    }
  }

  /** Fetches, one at a time and in the background, the conversations likely to be opened next. */
  async prefetch(taskIds: string[]): Promise<void> {
    for (const id of taskIds) {
      if (this.state.status !== 'online') return
      if (!this.state.details[id]) await this.detail(id)
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
        if (this.state.status === 'unpaired') return
        if (this.state.status !== 'online') {
          const wait = Math.min(30_000, 5_000 * 2 ** Math.max(0, this.failures - 1))
          this.set({ nextTryAt: new Date(this.o.now().getTime() + wait).toISOString() })
          await this.pause(wait)
          this.set({ nextTryAt: null })
        }
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
