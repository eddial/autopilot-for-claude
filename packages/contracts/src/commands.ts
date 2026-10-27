import { z } from 'zod'
import { DecisionOption } from './entities.ts'
import { Autonomy, Scope, SessionState, UpdateKind } from './enums.ts'
import { Duration, Id, IdempotencyKey, Link, Priority, TaskId, Timestamp } from './primitives.ts'

/** Every write carries an idempotency key, so a retried or replayed command applies once. */
export const command = <T extends z.ZodRawShape>(shape: T) => z.object({ idempotencyKey: IdempotencyKey, ...shape })

export const CreateTask = command({
  title: z.string().min(1).max(120),
  brief: z.string().max(20_000).default(''),
  /** Defaults from routing when omitted. */
  workstream: z.string().optional(),
  priority: Priority.optional(),
  links: z.array(Link).default([]),
  /** Start a session with the brief straight away (the default), or leave it in New. */
  start: z.boolean().default(true),
  /** Where it came from: an open task with the same thread gets the brief as an update instead. */
  sourceUrl: z.url().optional(),
  /** The team ticket it mirrors (`LLE-15982`): an open mirror gets the brief as an update instead. */
  ticket: z.object({ id: TaskId, closed: z.boolean() }).optional(),
})

export const EditTask = command({
  id: TaskId,
  title: z.string().min(1).max(120).optional(),
  /** Moving a task to another workstream re-files it and teaches routing. */
  workstream: z.string().optional(),
  priority: Priority.optional(),
  /** Auto-fix on its pull requests: on starts it for each one, off stops it. */
  autofix: z.boolean().optional(),
})

export const TaskRef = command({ id: TaskId })

export const SnoozeTask = command({ id: TaskId, until: Timestamp })

export const WatcherSpec = z.object({
  what: z.string().min(1).max(500),
  every: Duration.optional(),
  until: Timestamp.optional(),
  tools: z.array(z.string()).optional(),
})

export const WaitOn = command({ id: TaskId, on: z.string().min(1).max(200), watcher: WatcherSpec.optional() })

export const CloseTask = command({ id: TaskId, outcome: z.enum(['done', 'canceled']) })

export const BulkTasks = command({
  ids: z.array(TaskId).min(1).max(200),
  action: z.enum(['start', 'dismiss', 'snooze', 'move']),
  until: Timestamp.optional(),
  workstream: z.string().optional(),
})

/** Kinds a session or watcher may post; `instruction` comes only from answering, `signal` only from filing, `event` only from Autopilot. */
export const PostableKind = UpdateKind.exclude(['instruction', 'signal', 'event'])

export const PostUpdateFields = {
  taskId: TaskId,
  kind: PostableKind,
  body: z.string().min(1).max(20_000),
  options: z.array(DecisionOption).max(6).default([]),
  waitingOn: z.string().max(200).optional(),
  attachments: z.array(Link).default([]),
}

export const decisionHasOptions = <S extends z.ZodType<{ kind: string; options: unknown[] }>>(schema: S): S =>
  schema.refine((u) => (u.kind === 'decision') === u.options.length > 0, {
    message: 'A decision needs options, and only a decision has them',
    path: ['options'],
  })

export const PostUpdate = decisionHasOptions(command(PostUpdateFields))

/** Files the owner sent with an answer or an instruction: links from `files.upload`. */
export const SentFiles = z.array(Link).max(10).optional()

export const AnswerUpdateFields = {
  updateId: Id,
  optionId: z.string().optional(),
  text: z.string().max(20_000).optional(),
  attachments: SentFiles,
}

export const hasAnswer = <
  S extends z.ZodType<{ optionId?: string | undefined; text?: string | undefined; attachments?: Link[] | undefined }>,
>(
  schema: S,
): S =>
  schema.refine((a) => a.optionId !== undefined || (a.text !== undefined && a.text.length > 0) || (a.attachments?.length ?? 0) > 0, {
    message: 'Pick an option, write an answer or send a file',
  })

export const AnswerUpdate = hasAnswer(command(AnswerUpdateFields))

/** Tells the task's session something without an open ask; starts a session when there is none. */
export const Instruct = command({ taskId: TaskId, body: z.string().max(20_000), attachments: SentFiles }).refine(
  (i) => i.body.trim().length > 0 || (i.attachments?.length ?? 0) > 0,
  { message: 'Write something or send a file', path: ['body'] },
)

/**
 * A file the owner pastes or drops into a reply, kept with the task on the Mac for its session to
 * read. Base64, up to 20 MB; the same key writes the same file, so a retry stores it once.
 */
export const UploadFile = command({
  taskId: TaskId,
  name: z.string().min(1).max(200),
  type: z.string().max(200),
  data: z.base64().max(28_000_000),
})

export const AttachLink = command({ taskId: TaskId, link: Link })

/** A read: one of the task's own links, nothing else. */
export const PreviewLink = z.object({ taskId: TaskId, url: z.url() })

export const AddWatcher = command({ taskId: TaskId, ...WatcherSpec.shape })

export const RemoveWatcher = command({ id: Id })

/** The searches a signal run does before deciding to file, update or drop. */
export const MatchItems = z.object({ queries: z.array(z.string().min(1).max(100)).min(1).max(10) })

export const SourceItem = z.object({
  signal: z.string(),
  url: z.url(),
  sender: z.string(),
  channel: z.string(),
  at: Timestamp,
  title: z.string().max(120),
  summary: z.string().max(2_000),
  /** A team ticket assigned to the owner: the task mirrors it and closes when it closes. */
  ticket: CreateTask.shape.ticket,
})

export const FileItem = command({
  item: SourceItem,
  action: z.enum(['create', 'update', 'drop']),
  /** For `update`: the active task it belongs to. */
  taskId: TaskId.optional(),
  workstream: z.string().optional(),
  priority: Priority.optional(),
  /** For `update`: what is new and what it asks of the owner. */
  note: z.string().max(2_000).default(''),
  reason: z.string().max(500),
  searches: z.array(z.string()),
  gated: z.boolean(),
})

export const DecideRouting = command({ proposalId: Id, accept: z.boolean() })

export const RunSignal = command({ name: z.string(), dryMinutes: z.int().min(1).max(1440).optional() })

/** Everything still open at a signal's source, once; `dry` previews without filing. */
export const ImportSignal = command({ name: z.string(), dry: z.boolean().default(false) })

export const AddSignal = command({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Values for the example's placeholders. */
  values: z.record(z.string(), z.string().max(200)).default({}),
})

/** Reads the last days of the named signals' sources and proposes workstreams. Files nothing. */
export const SweepWorkstreams = command({
  signals: z.array(z.string()).min(1).max(10),
  days: z.int().min(1).max(30).default(14),
})

export const SaveWorkstream = command({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(40),
  routing: z.string().min(1).max(4_000),
  urgent: z.string().max(500).default(''),
  /** A git checkout for code work; each task gets a worktree. Empty takes it away. */
  repo: z.string().max(500).optional(),
  /** How the work is done: the `## Work` section. Left out, it stays as it is. */
  work: z.string().max(8_000).optional(),
  autonomy: Autonomy.optional(),
})

/** Sets a workstream's file aside; refused while it has open tasks. */
export const RemoveWorkstream = command({ name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) })

export const InstallService = command({})

/** The folder tasks with no repository work in: new, empty, or a git repository. */
export const SetWorkspace = command({ path: z.string().min(1) })

export const PauseSignal = command({ name: z.string(), paused: z.boolean() })

/** Rewrites what a source picks up: the text under its settings. */
export const DescribeSignal = command({ name: z.string(), rules: z.string().min(1).max(20_000) })

/** Stops listening to a source for good; the tasks it filed stay. */
export const RemoveSignal = command({ name: z.string() })

/** From the new device, with the code from the invite. The device gets its own token back. */
export const PairDevice = command({
  code: z.string().min(6).max(64),
  name: z.string().min(1).max(60),
  kind: z.enum(['mac', 'iphone']),
})

export const StartPairing = command({})

export const RemoveDevice = command({ id: Id })

export const CreateToken = command({ name: z.string().min(1).max(60), scope: Scope, taskId: TaskId.optional() })

export const RevokeToken = command({ id: Id })

/** Sent by a session's Claude Code hooks: what it is doing now, so answers wait until it is idle. */
export const ReportSession = command({
  taskId: TaskId,
  state: SessionState.exclude(['starting']),
  activity: z.string().max(200).optional(),
})
