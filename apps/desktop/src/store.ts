import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { execute, overlay, type Command, type Pending } from '@autopilot/client'
import {
  applyEvent,
  applyToDetail,
  emptyQueue,
  queueItems,
  type Change,
  type LiveQueue,
  type QueueItem,
  type TaskDetail,
} from '@autopilot/contracts'
import { api, key } from './api.ts'

/**
 * The window's copy of everything it shows, so nothing a person does waits on the server: the
 * queue from the live feed (saved, so the window draws at once on the next start), task details
 * kept current from the same feed, and commands applied to the screen in the same frame and sent
 * after, with the phone's `overlay`.
 */

export type Connection = 'connecting' | 'live' | 'offline'

type Sent = Pending & { seqAtSend: number; settled: boolean }

type State = {
  queue: LiveQueue
  connection: Connection
  error: string | null
  pending: Sent[]
  details: Record<string, TaskDetail>
  /** A command the server refused, shown until the next one. */
  refused: string | null
}

const CACHE_KEY = 'autopilot.queue'

const readCache = (): LiveQueue => {
  try {
    const text = localStorage.getItem(CACHE_KEY)
    return text ? (JSON.parse(text) as LiveQueue) : emptyQueue
  } catch {
    return emptyQueue
  }
}

let state: State = { queue: readCache(), connection: 'connecting', error: null, pending: [], details: {}, refused: null }
const listeners = new Set<() => void>()

const set = (next: Partial<State>): void => {
  state = { ...state, ...next }
  // A sent command stops being overlaid once the feed has moved past it.
  if (state.pending.some((p) => p.settled && state.queue.seq > p.seqAtSend)) {
    state = { ...state, pending: state.pending.filter((p) => !(p.settled && state.queue.seq > p.seqAtSend)) }
  }
  for (const listener of listeners) listener()
}

// Saving a big queue costs a few milliseconds; once a second at most, off the interaction.
let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveSoon = (): void => {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(state.queue))
    } catch {
      // Storage full or blocked: the next start draws when the snapshot arrives instead.
    }
  }, 1000)
}

/** One live subscription for the whole window, resuming after the last change it has. */
const run = async (): Promise<void> => {
  // A cache from another server (or a reset one) is dropped rather than resumed.
  if (state.queue.seq > 0) {
    try {
      const { latest } = await api.changes.since({ after: state.queue.seq, limit: 1 })
      if (latest < state.queue.seq) set({ queue: emptyQueue, details: {} })
    } catch {
      // Offline: keep showing the cache; the loop below retries.
    }
  }
  for (;;) {
    try {
      const resume = state.queue.seq > 0 || Object.keys(state.queue.tasks).length > 0
      performance.mark('autopilot:subscribe')
      const stream = await api.queue.subscribe(resume ? { after: state.queue.seq } : {})
      set({ connection: 'live', error: null })
      for await (const event of stream) {
        if (event.type === 'snapshot') performance.mark('autopilot:snapshot')
        else for (const missed of loading.values()) missed.push(event)
        const details =
          event.type === 'snapshot'
            ? {}
            : Object.fromEntries(Object.entries(state.details).map(([id, detail]) => [id, applyToDetail(detail, event)]))
        set({ queue: applyEvent(state.queue, event), details })
        saveSoon()
      }
    } catch (error) {
      set({ connection: 'offline', error: error instanceof Error ? error.message : String(error) })
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

let started = false
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (!started) {
    started = true
    void run()
  }
  return () => listeners.delete(listener)
}

export const useStore = (): State => useSyncExternalStore(subscribe, () => state)

/** The queue as shown: the feed's, with commands not yet confirmed applied on top. */
export const useQueueItems = (): QueueItem[] => {
  const { queue, pending } = useStore()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Bands move on their own (a snooze runs out).
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => queueItems(overlay(queue, pending, now), now), [queue, pending, now])
}

// ── details ──

/**
 * Conversations being fetched, with the feed changes that arrived meanwhile: the fetch may have been
 * answered before them, so they are applied to it when it lands (applying one twice is harmless).
 */
const loading = new Map<string, Change[]>()

/** Fetches a task's conversation once; the feed keeps it current from then on. */
export const prefetch = (taskId: string): void => {
  if (state.details[taskId] || loading.has(taskId) || taskId.startsWith('NEW-')) return
  const missed: Change[] = []
  loading.set(taskId, missed)
  api.tasks
    .get({ id: taskId })
    .then((detail) => set({ details: { ...state.details, [taskId]: missed.reduce(applyToDetail, detail) } }))
    .catch(() => {})
    .finally(() => loading.delete(taskId))
}

/** A task's conversation if the window has it, and the commands for it still on their way. */
export const useDetail = (taskId: string): { detail: TaskDetail | null; pending: Pending[] } => {
  const { details, pending } = useStore()
  useEffect(() => prefetch(taskId), [taskId])
  const mine = useMemo(() => pending.filter((p) => 'taskId' in p.command && p.command.taskId === taskId), [pending, taskId])
  return { detail: details[taskId] ?? null, pending: mine }
}

// ── commands ──

/** Applies a command to the screen now and sends it; a refusal undoes it and says why. */
export const send = (command: Command): void => {
  const sent: Sent = {
    id: key(),
    n: (state.pending.at(-1)?.n ?? 0) + 1,
    at: new Date().toISOString(),
    command,
    seqAtSend: state.queue.seq,
    settled: false,
  }
  set({ pending: [...state.pending, sent], refused: null })
  execute(api, sent)
    .then(() => {
      set({ pending: state.pending.map((p) => (p.id === sent.id ? { ...p, settled: true } : p)) })
      // If nothing else moves the feed, stop overlaying after a moment anyway.
      setTimeout(() => set({ pending: state.pending.filter((p) => p.id !== sent.id) }), 5000)
    })
    .catch((error: unknown) => {
      set({ pending: state.pending.filter((p) => p.id !== sent.id), refused: error instanceof Error ? error.message : String(error) })
    })
}

export const markSeen = (taskId: string): void => {
  void api.tasks.markSeen({ idempotencyKey: key(), id: taskId }).catch(() => {})
}
