import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { overlay, Sync, type Connection, type Storage, type SyncState } from '@autopilot/client'
import { queueItems, type QueueItem } from '@autopilot/contracts'
import * as BackgroundTask from 'expo-background-task'
import { randomUUID } from 'expo-crypto'
import * as Network from 'expo-network'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import KV from 'expo-sqlite/kv-store'
import * as TaskManager from 'expo-task-manager'
import { pinnedFetch } from './pinned.ts'

/** The pairing (routes, fingerprint and the device's token) lives in the Keychain. */
const CONNECTION_KEY = 'autopilot.connection'
const BACKGROUND_TASK = 'autopilot.sync'

/** The cache and outbox live in SQLite, so they survive the app being closed. */
const storage: Storage = {
  getSync: (key) => KV.getItemSync(`autopilot.${key}`),
  get: (key) => KV.getItem(`autopilot.${key}`),
  set: (key, value) => KV.setItem(`autopilot.${key}`, value),
}

const notify = (items: QueueItem[]) => {
  for (const item of items.slice(0, 3)) {
    void Notifications.scheduleNotificationAsync({
      content: { title: item.task.title, body: item.openAsk?.body.slice(0, 180) ?? 'Your turn', data: { taskId: item.task.id } },
      trigger: null,
    })
  }
}

const create = (connection: Connection): Sync =>
  new Sync({ connection, pinned: pinnedFetch, storage, newKey: randomUUID, onYourTurn: notify })

let current: { sync: Sync; connection: Connection } | null = null
const listeners = new Set<() => void>()
const changed = () => {
  for (const listener of listeners) listener()
}

export const loadConnection = async (): Promise<Connection | null> => {
  const text = await SecureStore.getItemAsync(CONNECTION_KEY)
  return text ? (JSON.parse(text) as Connection) : null
}

/** Starts syncing with a server just paired with. */
export const connectTo = async (connection: Connection, save: boolean): Promise<Sync> => {
  if (save) await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK })
  current?.sync.stop()
  const sync = create(connection)
  if (!sync.restore()) await sync.load()
  sync.start()
  current = { sync, connection }
  changed()
  return sync
}

/**
 * At launch, before the first frame: the pairing from the Keychain and the queue from SQLite, both
 * read synchronously, so the app opens on the queue as it was rather than on an empty screen.
 */
const boot = (): void => {
  try {
    const text = SecureStore.getItem(CONNECTION_KEY)
    if (!text) return
    const connection = JSON.parse(text) as Connection
    const sync = create(connection)
    sync.restore()
    current = { sync, connection }
  } catch {
    // Unreadable (the device is still locked after a restart): the layout pairs or retries.
  }
}
boot()

/** The sync started at launch, if the pairing could be read before the first frame. */
export const booted = (): Sync | null => current?.sync ?? null

export const unpair = async (): Promise<void> => {
  current?.sync.stop()
  current = null
  await SecureStore.deleteItemAsync(CONNECTION_KEY)
  changed()
}

export const useSyncInstance = (): Sync | null =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current?.sync ?? null,
  )

export const serverName = (): string => current?.connection.server ?? 'your Mac'

/** A conversation as the phone has it now, fetched in the background if it has none yet. */
export const useDetail = (taskId: string) => {
  const sync = useSyncInstance()
  const { details } = useSyncState()
  useEffect(() => {
    void sync?.detail(taskId)
  }, [sync, taskId])
  return details[taskId] ?? sync?.cachedDetail(taskId) ?? null
}

const emptyState: SyncState = {
  status: 'offline',
  routeKind: null,
  lastSyncedAt: null,
  queue: { seq: 0, tasks: {}, asks: {}, sessions: {} },
  outbox: [],
  conflicts: [],
  details: {},
}

export const useSyncState = (): SyncState => {
  const sync = useSyncInstance()
  return useSyncExternalStore(
    (listener) => sync?.subscribe(listener) ?? (() => {}),
    () => sync?.getState() ?? emptyState,
  )
}

/** The queue as shown: the cache with the outbox on top, recomputed each minute for snoozes. */
export const useItems = (): QueueItem[] => {
  const { queue, outbox } = useSyncState()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => queueItems(overlay(queue, outbox, now), now), [queue, outbox, now])
}

/** Syncs again when the app comes to the front or the network changes. */
export const useWakeUps = (sync: Sync | null): void => {
  useEffect(() => {
    if (!sync) return
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        sync.start()
        sync.kick()
      } else if (next === 'background') sync.stop()
    })
    const network = Network.addNetworkStateListener(() => sync.kick())
    return () => {
      app.remove()
      network.remove()
    }
  }, [sync])
}

// iOS wakes the app now and then (it decides how often); each time, send the outbox and catch up.
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const connection = current?.connection ?? (await loadConnection())
    if (!connection) return BackgroundTask.BackgroundTaskResult.Success
    const sync = current?.sync ?? create(connection)
    if (!current) await sync.load()
    await sync.syncOnce(0)
    return BackgroundTask.BackgroundTaskResult.Success
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

export const registerBackgroundSync = async (): Promise<void> => {
  const status = await BackgroundTask.getStatusAsync()
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return
  if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK))) await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 })
}

Notifications.setNotificationHandler({
  handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
})
