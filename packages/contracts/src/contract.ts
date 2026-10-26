import { eventIterator, oc } from '@orpc/contract'
import { z } from 'zod'
import { ChangesPage, QueueEvent, QueueSnapshot, Seq } from './changes.ts'
import {
  AddSignal,
  AddWatcher,
  AnswerUpdate,
  AttachLink,
  PreviewLink,
  BulkTasks,
  CloseTask,
  CreateTask,
  CreateToken,
  DecideRouting,
  EditTask,
  FileItem,
  ImportSignal,
  InstallService,
  SetWorkspace,
  Instruct,
  MatchItems,
  PairDevice,
  PauseSignal,
  PostUpdate,
  RemoveDevice,
  RemoveWatcher,
  ReportSession,
  RevokeToken,
  RunSignal,
  SaveWorkstream,
  RemoveWorkstream,
  SweepWorkstreams,
  SnoozeTask,
  StartPairing,
  TaskRef,
  WaitOn,
} from './commands.ts'
import {
  Decision,
  Detected,
  Pairing,
  SetupStatus,
  SignalExample,
  LinkPreview,
  SuggestedWorkstream,
  Device,
  Machine,
  RoutingProposal,
  Session,
  Signal,
  Task,
  Token,
  Update,
  Watcher,
  Workstream,
} from './entities.ts'
import { Band, Scope } from './enums.ts'
import { errors } from './errors.ts'
import { TaskId } from './primitives.ts'

/**
 * Per-procedure access. A caller's token has one scope; the call is allowed
 * when that scope is listed. `ownTask` limits a `session` token to the task it
 * was issued for. `public` procedures need no token (pairing uses its own code).
 */
export type Meta = {
  scopes: readonly Scope[]
  ownTask?: boolean
  public?: boolean
}

const base = oc.$meta<Meta>({ scopes: ['owner'] }).errors(errors)

const OWNER = ['owner'] as const
const READERS = ['owner', 'read', 'create'] as const

/** A message a signal filed into the task, or added to it: what the task came from. */
export const TaskSignal = z.object({
  signal: z.string(),
  action: z.enum(['created', 'updated']),
  url: z.string(),
  sender: z.string(),
  channel: z.string(),
  at: z.string(),
  title: z.string(),
})
export type TaskSignal = z.infer<typeof TaskSignal>

export const TaskDetail = z.object({
  task: Task,
  band: Band,
  updates: z.array(Update),
  session: Session.nullable(),
  watchers: z.array(Watcher),
  /** Oldest first. Missing from servers before it was added. */
  signals: z.array(TaskSignal).optional(),
})
export type TaskDetail = z.infer<typeof TaskDetail>

export const MatchedTask = z.object({
  id: TaskId,
  title: z.string(),
  workstream: z.string(),
  state: Task.shape.state,
  sourceUrl: z.string().nullable(),
  links: Task.shape.links,
})

export const VersionInfo = z.object({ version: z.int(), oldestClient: z.int() })

export const contract = {
  meta: {
    version: base.meta({ scopes: [], public: true }).output(VersionInfo),
  },

  queue: {
    list: base
      .meta({ scopes: READERS })
      .input(z.object({ band: Band.optional(), workstream: z.string().optional(), filter: z.string().optional() }))
      .output(QueueSnapshot),
    /** A snapshot, then every change; pass `after` to resume without a snapshot. */
    subscribe: base
      .meta({ scopes: ['owner', 'read'] })
      .input(z.object({ after: Seq.optional() }))
      .output(eventIterator(QueueEvent)),
  },

  changes: {
    since: base
      .meta({ scopes: ['owner', 'read'] })
      .input(
        z.object({
          after: Seq,
          limit: z.int().min(1).max(1000).default(500),
          /** Seconds to hold the call open when nothing is new yet: a long poll for clients without a stream. */
          wait: z.int().min(0).max(25).default(0),
        }),
      )
      .output(ChangesPage),
  },

  tasks: {
    get: base
      .meta({ scopes: [...READERS, 'session'], ownTask: true })
      .input(z.object({ id: TaskId }))
      .output(TaskDetail),
    create: base
      .meta({ scopes: ['owner', 'create', 'session'] })
      .input(CreateTask)
      .output(Task),
    edit: base.meta({ scopes: OWNER }).input(EditTask).output(Task),
    start: base.meta({ scopes: OWNER }).input(TaskRef).output(Task),
    snooze: base.meta({ scopes: OWNER }).input(SnoozeTask).output(Task),
    wait: base
      .meta({ scopes: ['owner', 'session'], ownTask: true })
      .input(WaitOn)
      .output(Task),
    close: base.meta({ scopes: OWNER }).input(CloseTask).output(Task),
    markSeen: base.meta({ scopes: OWNER }).input(TaskRef).output(Task),
    bulk: base.meta({ scopes: OWNER }).input(BulkTasks).output(z.array(Task)),
  },

  updates: {
    post: base
      .meta({ scopes: ['session', 'watcher'], ownTask: true })
      .input(PostUpdate)
      .output(Update),
    /** Records the answer as an `instruction` and delivers it into the session when it is idle. */
    answer: base.meta({ scopes: OWNER }).input(AnswerUpdate).output(Update),
    instruct: base.meta({ scopes: OWNER }).input(Instruct).output(Update),
  },

  sessions: {
    /** From the session's own hooks: working, idle, waiting on a permission prompt, or ended. */
    report: base
      .meta({ scopes: ['session'], ownTask: true })
      .input(ReportSession)
      .output(Session),
  },

  links: {
    attach: base
      .meta({ scopes: ['owner', 'session'], ownTask: true })
      .input(AttachLink)
      .output(Task),
    /** The start of a text file the task links to: what a session made, readable in place. */
    preview: base
      .meta({ scopes: [...READERS] })
      .input(PreviewLink)
      .output(LinkPreview),
  },

  watchers: {
    add: base
      .meta({ scopes: ['owner', 'session'], ownTask: true })
      .input(AddWatcher)
      .output(Watcher),
    remove: base
      .meta({ scopes: ['owner', 'session'], ownTask: true })
      .input(RemoveWatcher)
      .output(z.object({})),
  },

  items: {
    match: base
      .meta({ scopes: ['signal'] })
      .input(MatchItems)
      .output(z.object({ tasks: z.array(MatchedTask) })),
    file: base
      .meta({ scopes: ['signal'] })
      .input(FileItem)
      .output(Decision),
  },

  routing: {
    list: base.meta({ scopes: OWNER }).output(z.array(RoutingProposal)),
    decide: base.meta({ scopes: OWNER }).input(DecideRouting).output(RoutingProposal),
  },

  signals: {
    list: base.meta({ scopes: ['owner', 'read'] }).output(z.array(Signal)),
    run: base.meta({ scopes: OWNER }).input(RunSignal).output(z.array(Decision)),
    /** A one-time import of what is still open at the source (`autopilot import linear`). */
    import: base.meta({ scopes: OWNER }).input(ImportSignal).output(z.array(Decision)),
    pause: base.meta({ scopes: OWNER }).input(PauseSignal).output(Signal),
    /** The example signals onboarding offers, and whether each is added. */
    examples: base.meta({ scopes: OWNER }).output(z.array(SignalExample)),
    /** Copies an example into the home, paused until it is resumed. */
    add: base.meta({ scopes: OWNER }).input(AddSignal).output(Signal),
  },

  setup: {
    status: base.meta({ scopes: OWNER }).output(SetupStatus),
    installService: base.meta({ scopes: OWNER }).input(InstallService).output(SetupStatus),
    setWorkspace: base.meta({ scopes: OWNER }).input(SetWorkspace).output(SetupStatus),
  },

  connectors: {
    /** What onboarding can offer: Claude Code's connectors and the GitHub CLI. Takes a few seconds. */
    detect: base.meta({ scopes: OWNER }).output(Detected),
  },

  workstreams: {
    list: base.meta({ scopes: [...READERS, 'signal'] }).output(z.array(Workstream)),
    /** The example workstreams, as starting points. */
    examples: base.meta({ scopes: OWNER }).output(z.array(Workstream)),
    /** Writes `## Routing` (and the repository); keeps the rest of an existing file. */
    save: base.meta({ scopes: OWNER }).input(SaveWorkstream).output(Workstream),
    remove: base.meta({ scopes: OWNER }).input(RemoveWorkstream).output(z.array(Workstream)),
    /** Onboarding, with permission: a broad read of the sources to propose workstreams. A minute or two. */
    sweep: base.meta({ scopes: OWNER }).input(SweepWorkstreams).output(z.array(SuggestedWorkstream)),
  },

  machines: {
    list: base.meta({ scopes: OWNER }).output(z.array(Machine)),
  },

  devices: {
    list: base.meta({ scopes: OWNER }).output(z.array(Device)),
    /** Authorised by the one-time pairing code, not a token. */
    /** A one-time invite, valid five minutes; opens the network listener for devices if it is not open yet. */
    startPairing: base.meta({ scopes: OWNER }).input(StartPairing).output(Pairing),
    pair: base
      .meta({ scopes: [], public: true })
      .input(PairDevice)
      .output(z.object({ device: Device, token: z.string() })),
    remove: base.meta({ scopes: OWNER }).input(RemoveDevice).output(z.object({})),
  },

  tokens: {
    list: base.meta({ scopes: OWNER }).output(z.array(Token)),
    /** The secret is returned once, here. */
    create: base
      .meta({ scopes: OWNER })
      .input(CreateToken)
      .output(z.object({ token: Token, secret: z.string() })),
    revoke: base.meta({ scopes: OWNER }).input(RevokeToken).output(z.object({})),
  },
}

export type Contract = typeof contract
