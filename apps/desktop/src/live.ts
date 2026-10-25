import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { applyEvent, emptyQueue, queueItems, type LiveQueue, type QueueItem } from '@autopilot/contracts'
import { api } from './api.ts'

export type Connection = 'connecting' | 'live' | 'offline'

type State = { queue: LiveQueue; connection: Connection; error: string | null }

let state: State = { queue: emptyQueue, connection: 'connecting', error: null }
const listeners = new Set<() => void>()
const set = (next: Partial<State>): void => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/** One live subscription for the whole window; it resumes from the last change it saw. */
const run = async (): Promise<void> => {
  let resumed = false
  for (;;) {
    try {
      const stream = await api.queue.subscribe(resumed ? { after: state.queue.seq } : {})
      set({ connection: 'live', error: null })
      for await (const event of stream) set({ queue: applyEvent(state.queue, event) })
      resumed = true
    } catch (error) {
      set({ connection: 'offline', error: error instanceof Error ? error.message : String(error) })
      resumed = state.queue.seq > 0
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

export const useLive = (): State => useSyncExternalStore(subscribe, () => state)

/** Bands move on their own (a snooze runs out), so the items are recomputed every minute too. */
export const useQueueItems = (): QueueItem[] => {
  const { queue } = useLive()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => queueItems(queue, now), [queue, now])
}
