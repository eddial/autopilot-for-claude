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
  /** On a preview: the item and where it would go. */
  title: z.string().optional(),
  workstream: z.string().optional(),
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

/** The start of a text file a task links to, to read without leaving the window. */
export const LinkPreview = z.object({
  /** Null when the file is not text, too large, or not on this Mac. */
  text: z.string().nullable(),
  bytes: z.int().min(0),
  truncated: z.boolean(),
})
export type LinkPreview = z.infer<typeof LinkPreview>

/** A workstream the sweep of your sources proposes, for you to keep, change or drop. */
export const SuggestedWorkstream = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(40),
  routing: z.string().describe('What lands here'),
  urgent: z.string().describe('When it is urgent'),
  /** Titles of real items from the sweep that belong here. */
  evidence: z.array(z.string()),
  /** Roughly how many items in the sweep. */
  count: z.int().min(0),
})
export type SuggestedWorkstream = z.infer<typeof SuggestedWorkstream>

/** One way to reach a server: a socket path, or `host:port` on the LAN or the tailnet. */
export const Route = z.object({
  kind: z.enum(['socket', 'lan', 'tailscale']),
  address: z.string(),
})
export type Route = z.infer<typeof Route>

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

/** An MCP server Claude Code has on this Mac, as a headless start reports it; for onboarding. */
export const Connector = z.object({
  name: z.string(),
  status: z.string().describe('As Claude Code reports it: connected, needs-auth, failed, pending'),
  tools: z.array(z.string()),
  /** The example signal that reads it, when there is one. */
  signal: z.string().nullable(),
})
export type Connector = z.infer<typeof Connector>

export const Detected = z.object({
  connectors: z.array(Connector),
  github: z.object({ cli: z.boolean(), user: z.string().nullable() }),
})
export type Detected = z.infer<typeof Detected>

/** A signal from `examples/home/signals/` that onboarding can add. */
export const SignalExample = z.object({
  name: z.string(),
  /** The first paragraph of its rules. */
  summary: z.string(),
  tools: z.array(z.string()),
  /** Placeholders the person fills in when adding it, like `YOUR_SLACK_USER_ID`. */
  fields: z.array(z.string()),
  added: z.boolean(),
})
export type SignalExample = z.infer<typeof SignalExample>

/** What onboarding checks before anything else. */
export const SetupStatus = z.object({
  claude: z.object({ installed: z.boolean(), version: z.string().nullable() }),
  /** The server runs as a launchd agent, so it keeps going when the app is closed. */
  service: z.boolean(),
  home: z.string(),
  signals: z.int(),
  workstreams: z.int(),
})
export type SetupStatus = z.infer<typeof SetupStatus>

/**
 * What a new device needs to reach and trust this server, shown as a QR code: the routes to try in
 * order, the SHA-256 fingerprint of the server's certificate to pin, and a one-time code.
 */
export const Invite = z.object({
  v: z.literal(1),
  server: z.string(),
  routes: z.array(Route).min(1),
  fingerprint: z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/),
  code: z.string(),
})
export type Invite = z.infer<typeof Invite>

export const Pairing = z.object({
  invite: Invite,
  expiresAt: Timestamp,
})
export type Pairing = z.infer<typeof Pairing>
