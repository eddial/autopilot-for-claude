import { z } from 'zod'

/**
 * What an update on a task is. The kind decides where the task goes next;
 * see docs/PRODUCT.md, "A task is a list of updates". An `event` is a line in the
 * timeline that moves nothing: a link attached, a watcher started or stopped.
 */
export const UpdateKind = z.enum(['decision', 'question', 'review', 'blocked', 'waiting', 'done', 'info', 'signal', 'instruction', 'event'])
export type UpdateKind = z.infer<typeof UpdateKind>

/** The kinds that put a task on your turn. A task has at most one open ask. */
/** What waits on the owner. `done` too: the session has finished, and the owner closes the task. */
export const ASK_KINDS = ['decision', 'question', 'review', 'blocked', 'done'] as const satisfies readonly UpdateKind[]
export type AskKind = (typeof ASK_KINDS)[number]

export const TaskState = z.enum(['triage', 'running', 'waiting', 'snoozed', 'done', 'canceled'])
export type TaskState = z.infer<typeof TaskState>

/** Where a task shows in the queue. Derived, never stored. */
export const Band = z.enum(['your_turn', 'triage', 'running', 'waiting', 'snoozed', 'done'])
export type Band = z.infer<typeof Band>

/**
 * What a caller may do. `session` is limited to the task its token names;
 * `signal` may only match and file items.
 */
export const Scope = z.enum(['owner', 'read', 'create', 'session', 'signal', 'watcher'])
export type Scope = z.infer<typeof Scope>

/** Who posted an update. `scout` is the first look a new task gets before anyone starts it. */
export const Author = z.enum(['owner', 'session', 'signal', 'watcher', 'system', 'scout'])
export type Author = z.infer<typeof Author>

export const SessionState = z.enum(['starting', 'working', 'idle', 'waiting_permission', 'ended'])
export type SessionState = z.infer<typeof SessionState>

/** 1 files only, 2 prepares when started, 3 starts by itself, 4 finishes within the workstream's rules. */
export const Autonomy = z.int().min(1).max(4)
