import { z } from 'zod'
import { QueueItem, Session, Signal, Task, Update, Workstream } from './entities.ts'
import { TaskId, Timestamp } from './primitives.ts'

/** Position in the change feed. Strictly increasing per server. */
export const Seq = z.int().min(0)

const change = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ seq: Seq, at: Timestamp, type: z.literal(type), ...shape })

/**
 * One row of the change feed. Every write adds one or more in the same
 * transaction; a client that remembers the last `seq` it saw catches up by
 * asking for everything after it.
 */
export const Change = z.discriminatedUnion('type', [
  change('task.upserted', { task: Task }),
  change('task.removed', { id: TaskId }),
  change('update.added', { update: Update }),
  change('update.changed', { update: Update }),
  change('session.changed', { session: Session }),
  change('signal.changed', { signal: Signal }),
  change('workstream.changed', { workstream: Workstream }),
])
export type Change = z.infer<typeof Change>

export const QueueSnapshot = z.object({
  seq: Seq,
  items: z.array(QueueItem),
})
export type QueueSnapshot = z.infer<typeof QueueSnapshot>

/** A live subscription starts with a snapshot (unless resuming), then streams changes. */
export const QueueEvent = z.union([z.object({ type: z.literal('snapshot'), snapshot: QueueSnapshot }), Change])
export type QueueEvent = z.infer<typeof QueueEvent>

export const ChangesPage = z.object({
  changes: z.array(Change),
  latest: Seq,
  more: z.boolean(),
})
