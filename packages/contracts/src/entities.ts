import { z } from 'zod'
import { Author, Autonomy, Band, Scope, SessionState, TaskState, UpdateKind } from './enums.ts'
import { Duration, Id, Link, Priority, TaskId, Timestamp } from './primitives.ts'

export const TaskSource = z.object({
  /** The signal that filed it, or null when created by hand or by an agent. */
  signal: z.string().nullable(),
  url: z.url().nullable(),
  /** A team ticket this task mirrors, e.g. LLE-15982. Branches and PRs name that ticket. */
  mirrors: z.string().nullable(),
})

export const Task = z.object({
  id: TaskId,
  title: z.string().min(1).max(120),
  /** The first prompt for the session; for signal tasks, who wants what and by when. */
  brief: z.string().max(20_000),
  workstream: z.string(),
  priority: Priority,
  state: TaskState,
  snoozedUntil: Timestamp.nullable(),
  source: TaskSource,
  links: z.array(Link),
  sessionId: Id.nullable(),
  createdBy: Author,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** When the owner last opened it; unread means a change after this. */
  seenAt: Timestamp.nullable(),
})
export type Task = z.infer<typeof Task>

export const DecisionOption = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(60),
})

export const Update = z.object({
  id: Id,
  taskId: TaskId,
  kind: UpdateKind,
  body: z.string().max(20_000).describe('Markdown'),
  /** Only for `decision`: the answers the session can act on. */
  options: z.array(DecisionOption),
  /** Only for `waiting`: who or what the task waits on. */
  waitingOn: z.string().nullable(),
  attachments: z.array(Link),
  author: Author,
  /** For `instruction`: the ask it answers. */
  answers: Id.nullable(),
  /** True for an ask that has not been answered yet. */
  open: z.boolean(),
  createdAt: Timestamp,
})
export type Update = z.infer<typeof Update>

export const Session = z.object({
  id: Id,
  taskId: TaskId,
  machineId: Id,
  cwd: z.string(),
  branch: z.string().nullable(),
  /** Opens the session in the Claude app on that Mac. */
  resumeUrl: z.string().nullable(),
  /** Opens the session anywhere through Remote Control. */
  remoteControlUrl: z.url().nullable(),
  state: SessionState,
  /** One line on what it is doing now. */
  activity: z.string().max(200).nullable(),
  startedAt: Timestamp,
  lastActivityAt: Timestamp,
})
export type Session = z.infer<typeof Session>

/** A task as the queue shows it. */
export const QueueItem = z.object({
  task: Task,
  band: Band,
  openAsk: Update.nullable(),
  session: Session.nullable(),
  unread: z.boolean(),
})
export type QueueItem = z.infer<typeof QueueItem>

export const Signal = z.object({
  name: z.string(),
  schedule: z.union([z.object({ every: Duration }), z.object({ cron: z.string() })]),
  tools: z.array(z.string()),
  model: z.string(),
  paused: z.boolean(),
  health: z.object({
    state: z.enum(['ok', 'failing', 'paused']),
    since: Timestamp.nullable(),
    message: z.string().nullable(),
  }),
  lastRunAt: Timestamp.nullable(),
  last24h: z.object({ filed: z.int(), updated: z.int(), dropped: z.int() }),
})
export type Signal = z.infer<typeof Signal>

/** One item a signal looked at, filed or not. */
export const Decision = z.object({
  id: Id,
  signal: z.string(),
  at: Timestamp,
  action: z.enum(['created', 'updated', 'dropped']),
  taskId: TaskId.nullable(),
  reason: z.string(),
  searches: z.array(z.string()),
  gated: z.boolean(),
})
export type Decision = z.infer<typeof Decision>

export const Watcher = z.object({
  id: Id,
  taskId: TaskId,
  what: z.string(),
  every: Duration,
  until: Timestamp,
  tools: z.array(z.string()),
  lastCheckedAt: Timestamp.nullable(),
})
export type Watcher = z.infer<typeof Watcher>

export const Workstream = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  routing: z.string().describe('What lands here'),
  urgent: z.string().describe('When it is urgent'),
  work: z.string().describe('How the work is done'),
  autonomy: Autonomy,
  repo: z.string().nullable(),
  folder: z.string().nullable(),
  machineId: Id.nullable(),
})
export type Workstream = z.infer<typeof Workstream>

export const Route = z.object({
  kind: z.enum(['socket', 'lan', 'tailscale']),
  address: z.string(),
})

export const Machine = z.object({
  id: Id,
  name: z.string(),
  roles: z.array(z.enum(['main', 'runner'])).min(1),
  capacity: z.int().min(0),
  running: z.int().min(0),
  workstreams: z.array(z.string()),
  routes: z.array(Route),
  health: z.enum(['online', 'offline', 'asleep']),
  lastSeenAt: Timestamp.nullable(),
})
export type Machine = z.infer<typeof Machine>

export const Device = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(['mac', 'iphone', 'cli']),
  createdAt: Timestamp,
  lastSeenAt: Timestamp.nullable(),
})
export type Device = z.infer<typeof Device>

export const Token = z.object({
  id: Id,
  name: z.string(),
  scope: Scope,
  /** For `session` tokens: the only task it may write to. */
  taskId: TaskId.nullable(),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
})
export type Token = z.infer<typeof Token>

export const RoutingProposal = z.object({
  id: Id,
  createdAt: Timestamp,
  reason: z.string(),
  changes: z.array(z.object({ file: z.string(), before: z.string(), after: z.string() })),
  state: z.enum(['open', 'accepted', 'rejected']),
})
export type RoutingProposal = z.infer<typeof RoutingProposal>
