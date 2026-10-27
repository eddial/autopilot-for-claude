import type { Link, LiveQueue, Task } from '@autopilot/contracts'
import type { Api } from './connection.ts'

/** Tasks created while offline show under this prefix until the server numbers them. */
export const PENDING_PREFIX = 'NEW-'

/** What a person can do to a task; applied to the screen at once, sent after (the phone keeps them while offline). */
export type Command =
  | { kind: 'answer'; taskId: string; updateId: string; optionId?: string; text?: string; attachments?: Link[] }
  | { kind: 'instruct'; taskId: string; body: string; attachments?: Link[] }
  | { kind: 'create'; title: string; brief: string; workstream?: string; priority?: number; start: boolean }
  | { kind: 'start'; taskId: string }
  /** Brings back an ended session with Remote Control, to open it; where the task stands is unchanged. */
  | { kind: 'resume'; taskId: string }
  | { kind: 'snooze'; taskId: string; until: string }
  | { kind: 'close'; taskId: string; outcome: 'done' | 'canceled' }
  | { kind: 'edit'; taskId: string; workstream?: string; priority?: number; autofix?: boolean }

/** A command waiting to be sent. Its id is the idempotency key, so sending it twice applies it once. */
export type Pending = { id: string; n: number; at: string; command: Command }

/** A command the server refused; the person decides what happens to it. */
export type Conflict = { id: string; command: Command; reason: 'already_answered' | 'task_closed' | 'rejected'; message: string }

/** Sends one command, with its id as the idempotency key, so sending it twice applies it once. */
export const execute = async (api: Api, { id, command: c }: Pending): Promise<unknown> => {
  const idempotencyKey = id
  switch (c.kind) {
    case 'answer':
      return api.updates.answer({
        idempotencyKey,
        updateId: c.updateId,
        ...(c.optionId ? { optionId: c.optionId } : {}),
        ...(c.text ? { text: c.text } : {}),
        ...(c.attachments?.length ? { attachments: c.attachments } : {}),
      })
    case 'instruct':
      return api.updates.instruct({
        idempotencyKey,
        taskId: c.taskId,
        body: c.body,
        ...(c.attachments?.length ? { attachments: c.attachments } : {}),
      })
    case 'create':
      return api.tasks.create({
        idempotencyKey,
        title: c.title,
        brief: c.brief,
        start: c.start,
        ...(c.workstream ? { workstream: c.workstream } : {}),
        ...(c.priority ? { priority: c.priority } : {}),
      })
    case 'start':
      return api.tasks.start({ idempotencyKey, id: c.taskId })
    case 'resume':
      return api.tasks.resume({ idempotencyKey, id: c.taskId })
    case 'snooze':
      return api.tasks.snooze({ idempotencyKey, id: c.taskId, until: c.until })
    case 'close':
      return api.tasks.close({ idempotencyKey, id: c.taskId, outcome: c.outcome })
    case 'edit':
      return api.tasks.edit({
        idempotencyKey,
        id: c.taskId,
        ...(c.workstream ? { workstream: c.workstream } : {}),
        ...(c.priority ? { priority: c.priority } : {}),
        ...(c.autofix === undefined ? {} : { autofix: c.autofix }),
      })
  }
}

/** Applies what is still in the outbox to the server's queue, so the screen shows it at once. */
export const overlay = (queue: LiveQueue, outbox: Pending[], now: Date): LiveQueue => {
  if (outbox.length === 0) return queue
  const tasks = { ...queue.tasks }
  const asks = { ...queue.asks }
  const at = now.toISOString()
  const touch = (id: string, changes: Partial<Task>) => {
    const task = tasks[id]
    if (task) tasks[id] = { ...task, ...changes, updatedAt: at, seenAt: at }
  }
  for (const { n, command: c } of outbox) {
    switch (c.kind) {
      case 'answer':
        if (asks[c.taskId]?.id === c.updateId) delete asks[c.taskId]
        touch(c.taskId, { state: 'running', snoozedUntil: null })
        break
      case 'instruct':
      case 'start':
        touch(c.taskId, { state: 'running', snoozedUntil: null })
        break
      case 'resume':
        break
      case 'snooze':
        touch(c.taskId, { state: 'snoozed', snoozedUntil: c.until })
        break
      case 'close':
        touch(c.taskId, { state: c.outcome })
        break
      case 'edit':
        touch(c.taskId, {
          ...(c.workstream ? { workstream: c.workstream } : {}),
          ...(c.priority ? { priority: c.priority } : {}),
          ...(c.autofix === undefined ? {} : { autofix: c.autofix }),
        })
        break
      case 'create': {
        const id = `${PENDING_PREFIX}${n}`
        tasks[id] = {
          id,
          title: c.title,
          brief: c.brief,
          workstream: c.workstream ?? 'inbox',
          priority: c.priority ?? 3,
          state: c.start ? 'running' : 'triage',
          snoozedUntil: null,
          source: { signal: null, url: null, mirrors: null },
          links: [],
          sessionId: null,
          createdBy: 'owner',
          createdAt: at,
          updatedAt: at,
          seenAt: at,
          autofix: true,
        }
        break
      }
    }
  }
  return { ...queue, tasks, asks }
}

/** A pending command as it reads in a conversation. */
export const pendingText = (command: Command): string | null => {
  switch (command.kind) {
    case 'answer':
      return command.text || filesText(command.attachments)
    case 'instruct':
      return command.body || filesText(command.attachments)
    default:
      return null
  }
}

/** "Sent notes.pdf", "Sent 3 files": what a message of files alone reads as. */
const filesText = (files: Link[] | undefined): string | null =>
  !files?.length ? null : files.length === 1 ? `Sent ${files[0]?.title ?? 'a file'}` : `Sent ${files.length} files`
