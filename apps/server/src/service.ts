import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'
import {
  bandOf,
  compareQueue,
  isAsk,
  type AddWatcher,
  type AnswerUpdate,
  type AttachLink,
  type Author,
  type BulkTasks,
  type Change,
  type CloseTask,
  type CreateTask,
  type CreateToken,
  type Device,
  type PairDevice,
  type DecideRouting,
  type Decision,
  type EditTask,
  type FileItem,
  type Instruct,
  type Link,
  type MatchItems,
  type PostUpdate,
  type ReportSession,
  type RoutingProposal,
  type QueueItem,
  type QueueSnapshot,
  type Scope,
  type Session,
  type SessionState,
  type SnoozeTask,
  type Task,
  type TaskDetail,
  type TaskRef,
  type Token,
  type Update,
  type WaitOn,
  type Watcher,
} from '@autopilot/contracts'
import type { z } from 'zod'

type In<T extends z.ZodType> = z.output<T>

export type ErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'SERVICE_UNAVAILABLE' | 'BAD_REQUEST'

/** A failure the API turns into the matching typed error of the contract. */
export class DomainError extends Error {
  readonly code: ErrorCode
  readonly data: Record<string, unknown>
  constructor(code: ErrorCode, data: Record<string, unknown>, message?: string) {
    super(message ?? code)
    this.code = code
    this.data = data
  }
}

/** Who is calling, from their token. */
export type Principal = { tokenId: string; name: string; scope: Scope; taskId: string | null }

export type OutboxKind = 'start_session' | 'deliver_answer' | 'end_session'
export type OutboxItem = { id: number; kind: OutboxKind; payload: { taskId: string; updateId?: string }; attempts: number }

type Row = Record<string, SQLInputValue>

/** A change before the store numbers and dates it. */
type NewChange = Change extends infer C ? (C extends Change ? Omit<C, 'seq' | 'at'> : never) : never

const json = (value: unknown) => JSON.stringify(value)
const parse = <T>(text: unknown): T => JSON.parse(String(text)) as T
const str = (v: unknown): string => String(v)
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export const newId = (): string => `${Date.now().toString(36)}${randomBytes(5).toString('hex')}`
export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex')

const ACTIVE = `state not in ('done', 'canceled')`

/**
 * Everything the API can do, on top of SQLite. Each write runs in one
 * transaction that also appends to the change feed and records the
 * idempotency key, so a replayed command returns the first result.
 */
export class Service {
  readonly db: DatabaseSync
  readonly now: () => Date
  readonly defaultWorkstream: string
  readonly machineId: string
  private depth = 0
  private wrote = false
  private readonly listeners = new Set<() => void>()

  constructor(opts: { db: DatabaseSync; now?: () => Date; defaultWorkstream?: string; machineId?: string }) {
    this.db = opts.db
    this.now = opts.now ?? (() => new Date())
    this.defaultWorkstream = opts.defaultWorkstream ?? 'inbox'
    this.machineId = opts.machineId ?? 'local'
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  /** Prepared once per distinct SQL text: preparing is most of the cost of a small query. */
  private readonly statements = new Map<string, StatementSync>()

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.statements.set(text, statement)
    }
    return statement
  }

  private iso(): string {
    return this.now().toISOString()
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    this.db.exec('begin immediate')
    this.depth++
    this.wrote = false
    try {
      const result = fn()
      this.db.exec('commit')
      if (this.wrote) for (const listener of this.listeners) listener()
      return result
    } catch (error) {
      this.db.exec('rollback')
      throw error
    } finally {
      this.depth--
    }
  }

  /** Called after every commit that added to the change feed. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Runs a write once per idempotency key; a repeat returns the stored result. */
  /** `stored` is what a replay gets back; secrets are left out of it, so they never sit in the database. */
  idempotent<T>(key: string, procedure: string, fn: () => T, stored: (result: T) => T = (result) => result): T {
    return this.transaction(() => {
      const done = this.sql('select procedure, result from applied where key = ?').get(key) as Row | undefined
      if (done) {
        if (done.procedure !== procedure) throw new DomainError('CONFLICT', { reason: 'version_mismatch' }, 'Key reused')
        return parse<T>(done.result)
      }
      const result = fn()
      this.db
        .prepare('insert into applied (key, procedure, result, at) values (?, ?, ?, ?)')
        .run(key, procedure, json(stored(result) ?? null), this.iso())
      return result
    })
  }

  private emit(change: NewChange): void {
    const { type, ...payload } = change
    this.sql('insert into changes (at, type, payload) values (?, ?, ?)').run(this.iso(), type, json(payload))
    this.wrote = true
  }

  private enqueue(kind: OutboxKind, payload: OutboxItem['payload']): void {
    this.sql('insert into outbox (kind, payload, created_at) values (?, ?, ?)').run(kind, json(payload), this.iso())
  }

  latestSeq(): number {
    const row = this.sql('select coalesce(max(seq), 0) as seq from changes').get() as { seq: number }
    return Number(row.seq)
  }

  changesSince(after: number, limit: number): { changes: Change[]; latest: number; more: boolean } {
    const rows = this.db
      .prepare('select seq, at, type, payload from changes where seq > ? order by seq limit ?')
      .all(after, limit + 1) as Row[]
    const changes = rows
      .slice(0, limit)
      .map((r) => ({ seq: Number(r.seq), at: str(r.at), type: r.type, ...parse<object>(r.payload) }) as Change)
    return { changes, latest: this.latestSeq(), more: rows.length > limit }
  }

  // ── mapping ───────────────────────────────────────────────────────────────

  private toTask(r: Row): Task {
    return {
      id: str(r.id),
      title: str(r.title),
      brief: str(r.brief),
      workstream: str(r.workstream),
      priority: Number(r.priority),
      state: str(r.state) as Task['state'],
      snoozedUntil: strOrNull(r.snoozed_until),
      source: { signal: strOrNull(r.source_signal), url: strOrNull(r.source_url), mirrors: strOrNull(r.mirrors) },
      links: parse<Link[]>(r.links),
      sessionId: strOrNull(r.session_id),
      createdBy: str(r.created_by) as Author,
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      seenAt: strOrNull(r.seen_at),
    }
  }

  private toUpdate(r: Row): Update {
    return {
      id: str(r.id),
      taskId: str(r.task_id),
      kind: str(r.kind) as Update['kind'],
      body: str(r.body),
      options: parse<Update['options']>(r.options),
      waitingOn: strOrNull(r.waiting_on),
      attachments: parse<Link[]>(r.attachments),
      author: str(r.author) as Author,
      answers: strOrNull(r.answers),
      open: Number(r.open) === 1,
      createdAt: str(r.created_at),
    }
  }

  private toSession(r: Row): Session {
    return {
      id: str(r.id),
      taskId: str(r.task_id),
      machineId: str(r.machine_id),
      cwd: str(r.cwd),
      branch: strOrNull(r.branch),
      resumeUrl: strOrNull(r.resume_url),
      remoteControlUrl: strOrNull(r.remote_control_url),
      state: str(r.state) as SessionState,
      activity: strOrNull(r.activity),
      startedAt: str(r.started_at),
      lastActivityAt: str(r.last_activity_at),
    }
  }

  private toWatcher(r: Row): Watcher {
    return {
      id: str(r.id),
      taskId: str(r.task_id),
      what: str(r.what),
      every: str(r.every),
      until: str(r.until),
      tools: parse<string[]>(r.tools),
      lastCheckedAt: strOrNull(r.last_checked_at),
    }
  }

  private toToken(r: Row): Token {
    return {
      id: str(r.id),
      name: str(r.name),
      scope: str(r.scope) as Scope,
      taskId: strOrNull(r.task_id),
      createdAt: str(r.created_at),
      lastUsedAt: strOrNull(r.last_used_at),
    }
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  task(id: string): Task {
    const row = this.sql('select * from tasks where id = ?').get(id) as Row | undefined
    if (!row) throw new DomainError('NOT_FOUND', { entity: 'task', id })
    return this.toTask(row)
  }

  private update(id: string): Update {
    const row = this.sql('select * from updates where id = ?').get(id) as Row | undefined
    if (!row) throw new DomainError('NOT_FOUND', { entity: 'update', id })
    return this.toUpdate(row)
  }

  private openAsk(taskId: string): Update | null {
    const row = this.db.prepare('select * from updates where task_id = ? and open = 1 order by created_at desc limit 1').get(taskId) as
      Row | undefined
    return row ? this.toUpdate(row) : null
  }

  session(id: string | null): Session | null {
    if (id === null) return null
    const row = this.sql('select * from sessions where id = ?').get(id) as Row | undefined
    return row ? this.toSession(row) : null
  }

  private item(task: Task): QueueItem {
    const openAsk = this.openAsk(task.id)
    const session = this.session(task.sessionId)
    return {
      task,
      band: bandOf({ task, openAsk, session }, this.now()),
      openAsk,
      session,
      unread: task.seenAt === null || task.updatedAt > task.seenAt,
    }
  }

  getTask(id: string): TaskDetail {
    const task = this.task(id)
    const item = this.item(task)
    const updates = (this.sql('select * from updates where task_id = ? order by created_at, id').all(id) as Row[]).map((r) =>
      this.toUpdate(r),
    )
    const watchers = (this.sql('select * from watchers where task_id = ?').all(id) as Row[]).map((r) => this.toWatcher(r))
    return { task, band: item.band, updates, session: item.session, watchers }
  }

  queue(
    filter: { band?: QueueItem['band'] | undefined; workstream?: string | undefined; filter?: string | undefined } = {},
  ): QueueSnapshot {
    const done = filter.band === 'done'
    // Done is history: the most recent two hundred are enough to look back on.
    const rows = this.sql(
      done
        ? `select * from tasks where state in ('done', 'canceled') order by updated_at desc limit 200`
        : `select * from tasks where ${ACTIVE}`,
    ).all() as Row[]
    // Three queries for the whole queue, not two per task: open asks and sessions come in bulk.
    const asks = new Map<string, Update>()
    for (const r of this.sql(`select * from updates where open = 1 order by created_at`).all() as Row[])
      asks.set(str(r.task_id), this.toUpdate(r))
    const sessions = new Map<string, Session>()
    const sessionRows = this.sql(
      done
        ? `select s.* from sessions s join tasks t on t.session_id = s.id where t.state in ('done', 'canceled')`
        : `select s.* from sessions s join tasks t on t.session_id = s.id where t.${ACTIVE}`,
    ).all() as Row[]
    for (const r of sessionRows) sessions.set(str(r.id), this.toSession(r))
    const now = this.now()
    const needle = filter.filter?.toLowerCase()
    const items = rows
      .map((r) => {
        const task = this.toTask(r)
        const openAsk = asks.get(task.id) ?? null
        const session = task.sessionId ? (sessions.get(task.sessionId) ?? null) : null
        return {
          task,
          band: bandOf({ task, openAsk, session }, now),
          openAsk,
          session,
          unread: task.seenAt === null || task.updatedAt > task.seenAt,
        }
      })
      .filter((i) => (filter.band ? i.band === filter.band : true))
      .filter((i) => (filter.workstream ? i.task.workstream === filter.workstream : true))
      .filter((i) => (needle ? i.task.title.toLowerCase().includes(needle) : true))
      .toSorted(compareQueue)
    return { seq: this.latestSeq(), items }
  }

  // ── tasks ─────────────────────────────────────────────────────────────────

  private nextTaskId(): { id: string; num: number } {
    const row = this.sql('select coalesce(max(num), 0) + 1 as num from tasks').get() as { num: number }
    const num = Number(row.num)
    return { id: `AP-${num}`, num }
  }

  private saveTask(task: Task): Task {
    this.db
      .prepare(
        `update tasks set title = ?, brief = ?, workstream = ?, priority = ?, state = ?, snoozed_until = ?,
         links = ?, session_id = ?, updated_at = ?, seen_at = ? where id = ?`,
      )
      .run(
        task.title,
        task.brief,
        task.workstream,
        task.priority,
        task.state,
        task.snoozedUntil,
        json(task.links),
        task.sessionId,
        task.updatedAt,
        task.seenAt,
        task.id,
      )
    this.emit({ type: 'task.upserted', task })
    return task
  }

  private touch(task: Task, changes: Partial<Task>): Task {
    return this.saveTask({ ...task, ...changes, updatedAt: this.iso() })
  }

  private insertTask(fields: {
    title: string
    brief: string
    workstream: string
    priority: number
    state: Task['state']
    source: Task['source']
    links: Link[]
    createdBy: Author
  }): Task {
    const { id, num } = this.nextTaskId()
    const at = this.iso()
    this.db
      .prepare(
        `insert into tasks (id, num, title, brief, workstream, priority, state, source_signal, source_url, mirrors,
         links, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        num,
        fields.title,
        fields.brief,
        fields.workstream,
        fields.priority,
        fields.state,
        fields.source.signal,
        fields.source.url,
        fields.source.mirrors,
        json(fields.links),
        fields.createdBy,
        at,
        at,
      )
    const task = this.task(id)
    this.emit({ type: 'task.upserted', task })
    return task
  }

  private assertOpen(task: Task): void {
    if (task.state === 'done' || task.state === 'canceled') {
      throw new DomainError('CONFLICT', { reason: 'task_closed' })
    }
  }

  createTask(input: In<typeof CreateTask>, by: Author = 'owner'): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.create', () => {
      const task = this.insertTask({
        title: input.title,
        brief: input.brief,
        workstream: input.workstream ?? this.defaultWorkstream,
        priority: input.priority ?? 3,
        state: input.start ? 'running' : 'new',
        source: { signal: null, url: null, mirrors: null },
        links: input.links,
        createdBy: by,
      })
      if (input.start) this.enqueue('start_session', { taskId: task.id })
      return task
    })
  }

  editTask(input: In<typeof EditTask>): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.edit', () => {
      const task = this.task(input.id)
      if (input.workstream && input.workstream !== task.workstream) this.correct(task, 'workstream', task.workstream, input.workstream)
      if (input.priority && input.priority !== task.priority) this.correct(task, 'priority', String(task.priority), String(input.priority))
      return this.touch(task, {
        title: input.title ?? task.title,
        workstream: input.workstream ?? task.workstream,
        priority: input.priority ?? task.priority,
      })
    })
  }

  startTask(input: In<typeof TaskRef>): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.start', () => this.start(this.task(input.id)))
  }

  private start(task: Task): Task {
    this.assertOpen(task)
    if (task.state === 'running' && task.sessionId) return task
    const started = this.touch(task, { state: 'running', snoozedUntil: null })
    if (!this.liveSession(task)) this.enqueue('start_session', { taskId: task.id })
    return started
  }

  private liveSession(task: Task): Session | null {
    const session = this.session(task.sessionId)
    return session && session.state !== 'ended' ? session : null
  }

  snoozeTask(input: In<typeof SnoozeTask>): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.snooze', () => {
      const task = this.task(input.id)
      this.assertOpen(task)
      return this.touch(task, { state: 'snoozed', snoozedUntil: input.until })
    })
  }

  waitOn(input: In<typeof WaitOn>, author: Author): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.wait', () => {
      const task = this.task(input.id)
      this.assertOpen(task)
      this.insertUpdate(task, { kind: 'waiting', body: `Waiting on ${input.on}`, waitingOn: input.on, author })
      if (input.watcher) this.insertWatcher(task.id, input.watcher)
      return this.touch(task, { state: 'waiting' })
    })
  }

  closeTask(input: In<typeof CloseTask>): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.close', () => {
      const task = this.task(input.id)
      if (input.outcome === 'canceled' && task.state === 'new') this.correct(task, 'dismissed', null, null)
      return this.close(task, input.outcome)
    })
  }

  /** Only what a signal filed teaches routing; the owner's own tasks are theirs to place. */
  private correct(task: Task, kind: 'workstream' | 'priority' | 'dismissed', before: string | null, after: string | null): void {
    if (task.createdBy !== 'signal') return
    this.db
      .prepare('insert into corrections (id, at, task_id, kind, before, after) values (?, ?, ?, ?, ?, ?)')
      .run(newId(), this.iso(), task.id, kind, before, after)
  }

  // ── routing review ────────────────────────────────────────────────────────

  /** What the routing review reads: the owner's corrections and the signals' decisions since `since`. */
  routingEvidence(since: string): {
    corrections: {
      at: string
      taskId: string
      title: string
      signal: string | null
      kind: string
      before: string | null
      after: string | null
    }[]
    decisions: { at: string; signal: string; action: string; taskId: string | null; reason: string; title: string }[]
    byHand: { taskId: string; title: string; workstream: string; createdAt: string }[]
  } {
    const corrections = (
      this.db
        .prepare(`select c.*, t.title, t.source_signal from corrections c join tasks t on t.id = c.task_id where c.at > ? order by c.at`)
        .all(since) as Row[]
    ).map((r) => ({
      at: str(r.at),
      taskId: str(r.task_id),
      title: str(r.title),
      signal: strOrNull(r.source_signal),
      kind: str(r.kind),
      before: strOrNull(r.before),
      after: strOrNull(r.after),
    }))
    const decisions = (this.sql('select * from decisions where at > ? order by at').all(since) as Row[]).map((r) => ({
      at: str(r.at),
      signal: str(r.signal),
      action: str(r.action),
      taskId: strOrNull(r.task_id),
      reason: str(r.reason),
      title: parse<{ title?: string }>(r.item).title ?? '',
    }))
    const byHand = (
      this.sql(`select * from tasks where created_by = 'owner' and created_at > ? order by created_at`).all(since) as Row[]
    ).map((r) => ({ taskId: str(r.id), title: str(r.title), workstream: str(r.workstream), createdAt: str(r.created_at) }))
    return { corrections, decisions, byHand }
  }

  private toProposal(r: Row): RoutingProposal {
    return {
      id: str(r.id),
      createdAt: str(r.created_at),
      reason: str(r.reason),
      changes: parse<RoutingProposal['changes']>(r.changes),
      state: str(r.state) as RoutingProposal['state'],
    }
  }

  proposals(): RoutingProposal[] {
    return (this.sql(`select * from routing_proposals order by created_at desc limit 100`).all() as Row[]).map((r) => this.toProposal(r))
  }

  /** A proposal waits on the owner as a review in the `autopilot` workstream. */
  propose(reason: string, changes: RoutingProposal['changes']): RoutingProposal {
    return this.transaction(() => {
      const id = newId()
      const diff = changes.map((c) => `${c.file}\n- ${c.before}\n+ ${c.after}`).join('\n\n')
      const task = this.systemTask(`Routing: ${reason}`, `${reason}\n\n${diff}\n\nAccept or reject it with routing.decide.`)
      this.db
        .prepare('insert into routing_proposals (id, created_at, reason, changes, state, task_id) values (?, ?, ?, ?, ?, ?)')
        .run(id, this.iso(), reason, json(changes), 'open', task.id)
      return this.toProposal(this.sql('select * from routing_proposals where id = ?').get(id) as Row)
    })
  }

  /** `apply` writes the change to the home files; it runs inside the transaction, so a failure keeps the proposal open. */
  decideProposal(input: In<typeof DecideRouting>, apply: (changes: RoutingProposal['changes']) => void): RoutingProposal {
    return this.idempotent(input.idempotencyKey, 'routing.decide', () => {
      const row = this.sql('select * from routing_proposals where id = ?').get(input.proposalId) as Row | undefined
      if (!row) throw new DomainError('NOT_FOUND', { entity: 'routing proposal', id: input.proposalId })
      const proposal = this.toProposal(row)
      if (proposal.state !== 'open') throw new DomainError('CONFLICT', { reason: 'already_answered' }, 'Already decided')
      if (input.accept) apply(proposal.changes)
      const state = input.accept ? 'accepted' : 'rejected'
      this.sql('update routing_proposals set state = ? where id = ?').run(state, proposal.id)
      const taskId = strOrNull(row.task_id)
      if (taskId) this.close(this.task(taskId), input.accept ? 'done' : 'canceled')
      return { ...proposal, state }
    })
  }

  /** When one of Autopilot's own jobs last ran. */
  jobRanAt(name: string): string | null {
    const row = this.sql('select last_run_at from jobs where name = ?').get(name) as Row | undefined
    return row ? str(row.last_run_at) : null
  }

  jobRan(name: string, at: string): void {
    this.sql('insert into jobs (name, last_run_at) values (?, ?) on conflict(name) do update set last_run_at = excluded.last_run_at').run(
      name,
      at,
    )
  }

  /** Closing ends the session and the watchers with it. */
  private close(task: Task, outcome: 'done' | 'canceled'): Task {
    if (task.state === 'done' || task.state === 'canceled') return task
    this.closeAsks(task.id)
    if (this.liveSession(task)) this.enqueue('end_session', { taskId: task.id })
    this.sql('delete from watchers where task_id = ?').run(task.id)
    return this.touch(task, { state: outcome })
  }

  markSeen(input: In<typeof TaskRef>): Task {
    return this.idempotent(input.idempotencyKey, 'tasks.markSeen', () => {
      const task = this.task(input.id)
      return this.saveTask({ ...task, seenAt: this.iso() })
    })
  }

  bulk(input: In<typeof BulkTasks>): Task[] {
    return this.idempotent(input.idempotencyKey, 'tasks.bulk', () =>
      input.ids.map((id) => {
        const task = this.task(id)
        switch (input.action) {
          case 'start':
            return this.start(task)
          case 'dismiss':
            if (task.state === 'new') this.correct(task, 'dismissed', null, null)
            return this.close(task, 'canceled')
          case 'snooze':
            if (!input.until) throw new DomainError('BAD_REQUEST', { field: 'until' }, 'Snooze needs a time')
            return this.touch(task, { state: 'snoozed', snoozedUntil: input.until })
          case 'move':
            if (!input.workstream) throw new DomainError('BAD_REQUEST', { field: 'workstream' }, 'Move needs a workstream')
            if (input.workstream !== task.workstream) this.correct(task, 'workstream', task.workstream, input.workstream)
            return this.touch(task, { workstream: input.workstream })
        }
      }),
    )
  }

  attachLink(input: In<typeof AttachLink>): Task {
    return this.idempotent(input.idempotencyKey, 'links.attach', () => {
      const task = this.task(input.taskId)
      if (task.links.some((l) => l.url === input.link.url)) return task
      return this.touch(task, { links: [...task.links, input.link] })
    })
  }

  // ── updates ───────────────────────────────────────────────────────────────

  private closeAsks(taskId: string): void {
    const open = this.sql('select * from updates where task_id = ? and open = 1').all(taskId) as Row[]
    for (const row of open) {
      this.sql('update updates set open = 0 where id = ?').run(str(row.id))
      this.emit({ type: 'update.changed', update: { ...this.toUpdate(row), open: false } })
    }
  }

  private insertUpdate(
    task: Task,
    u: {
      kind: Update['kind']
      body: string
      author: Author
      options?: Update['options']
      waitingOn?: string | null
      attachments?: Link[]
      answers?: string | null
    },
  ): Update {
    const ask = isAsk(u.kind)
    if (ask) this.closeAsks(task.id)
    const id = newId()
    this.db
      .prepare(
        `insert into updates (id, task_id, kind, body, options, waiting_on, attachments, author, answers, open, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        task.id,
        u.kind,
        u.body,
        json(u.options ?? []),
        u.waitingOn ?? null,
        json(u.attachments ?? []),
        u.author,
        u.answers ?? null,
        ask ? 1 : 0,
        this.iso(),
      )
    const update = this.update(id)
    this.emit({ type: 'update.added', update })
    return update
  }

  postUpdate(input: In<typeof PostUpdate>, author: Author): Update {
    return this.idempotent(input.idempotencyKey, 'updates.post', () => {
      const task = this.task(input.taskId)
      this.assertOpen(task)
      const update = this.insertUpdate(task, {
        kind: input.kind,
        body: input.body,
        author,
        options: input.options,
        waitingOn: input.waitingOn ?? null,
        attachments: input.attachments,
      })
      const state: Task['state'] = input.kind === 'waiting' ? 'waiting' : task.state === 'new' ? 'new' : 'running'
      this.touch(task, { state })
      return update
    })
  }

  /** Records the answer as an instruction, then hands it to the session (or starts one). */
  answerUpdate(input: In<typeof AnswerUpdate>): Update {
    return this.idempotent(input.idempotencyKey, 'updates.answer', () => {
      const ask = this.update(input.updateId)
      const task = this.task(ask.taskId)
      this.assertOpen(task)
      if (!ask.open) throw new DomainError('CONFLICT', { reason: 'already_answered' })
      const option = input.optionId ? ask.options.find((o) => o.id === input.optionId) : undefined
      if (input.optionId && !option) throw new DomainError('BAD_REQUEST', { field: 'optionId' }, 'Unknown option')
      const body = [option?.label, input.text].filter(Boolean).join('\n\n')
      const instruction = this.insertUpdate(task, { kind: 'instruction', body, author: 'owner', answers: ask.id })
      this.closeAsks(task.id)
      this.touch(task, { state: 'running', snoozedUntil: null, seenAt: this.iso() })
      if (this.liveSession(task)) this.enqueue('deliver_answer', { taskId: task.id, updateId: instruction.id })
      else this.enqueue('start_session', { taskId: task.id })
      return instruction
    })
  }

  instruct(input: In<typeof Instruct>): Update {
    return this.idempotent(input.idempotencyKey, 'updates.instruct', () => {
      const task = this.task(input.taskId)
      this.assertOpen(task)
      const instruction = this.insertUpdate(task, { kind: 'instruction', body: input.body, author: 'owner' })
      this.touch(task, { state: 'running', snoozedUntil: null, seenAt: this.iso() })
      if (this.liveSession(task)) this.enqueue('deliver_answer', { taskId: task.id, updateId: instruction.id })
      else this.enqueue('start_session', { taskId: task.id })
      return instruction
    })
  }

  // ── watchers ──────────────────────────────────────────────────────────────

  private insertWatcher(
    taskId: string,
    spec: { what: string; every?: string | undefined; until?: string | undefined; tools?: string[] | undefined },
  ): Watcher {
    const id = newId()
    const until = spec.until ?? new Date(this.now().getTime() + 14 * 86_400_000).toISOString()
    this.db
      .prepare('insert into watchers (id, task_id, what, every, until, tools) values (?, ?, ?, ?, ?, ?)')
      .run(id, taskId, spec.what, spec.every ?? '30m', until, json(spec.tools ?? []))
    return this.toWatcher(this.sql('select * from watchers where id = ?').get(id) as Row)
  }

  addWatcher(input: In<typeof AddWatcher>): Watcher {
    return this.idempotent(input.idempotencyKey, 'watchers.add', () => {
      this.assertOpen(this.task(input.taskId))
      return this.insertWatcher(input.taskId, input)
    })
  }

  watcherTask(id: string): string {
    const row = this.sql('select task_id from watchers where id = ?').get(id) as Row | undefined
    if (!row) throw new DomainError('NOT_FOUND', { entity: 'watcher', id })
    return str(row.task_id)
  }

  removeWatcher(input: { idempotencyKey: string; id: string }): Record<string, never> {
    return this.idempotent(input.idempotencyKey, 'watchers.remove', () => {
      this.sql('delete from watchers where id = ?').run(input.id)
      return {}
    })
  }

  /** Every watcher with what the runner needs: its last fingerprint and its task. */
  watcherRuns(): { watcher: Watcher; fingerprint: string | null; task: Task; band: QueueItem['band'] }[] {
    const rows = this.sql('select * from watchers').all() as Row[]
    return rows.map((r) => {
      const task = this.task(str(r.task_id))
      return { watcher: this.toWatcher(r), fingerprint: strOrNull(r.fingerprint), task, band: this.item(task).band }
    })
  }

  /** A check ran; without a fingerprint (it failed, or had nothing to read with) the last one stays. */
  watcherChecked(id: string, fingerprint: string | null): void {
    this.db
      .prepare('update watchers set fingerprint = coalesce(?, fingerprint), last_checked_at = ? where id = ?')
      .run(fingerprint, this.iso(), id)
  }

  /**
   * A person acted on what the task waits on. With autonomy to start by itself the session picks it
   * up (a live one once idle, else a new one); otherwise it is the owner's turn.
   */
  watcherNews(id: string, news: { body: string; attachments: Link[]; wake: boolean }): Update {
    return this.transaction(() => {
      const task = this.task(this.watcherTask(id))
      const update = this.insertUpdate(task, {
        kind: news.wake ? 'info' : 'question',
        body: news.wake ? news.body : `${news.body}\n\nStart the task to let the session act on it, or close it.`,
        author: 'watcher',
        attachments: news.attachments,
      })
      if (news.wake) {
        this.touch(task, { state: 'running', snoozedUntil: null })
        if (this.liveSession(task)) this.enqueue('deliver_answer', { taskId: task.id, updateId: update.id })
        else this.enqueue('start_session', { taskId: task.id })
      } else {
        this.touch(task, {})
      }
      return update
    })
  }

  /** `until` has passed with nothing new: the watcher goes, and a waiting task becomes the owner's call. */
  watcherExpired(id: string): void {
    this.transaction(() => {
      const row = this.sql('select * from watchers where id = ?').get(id) as Row | undefined
      if (!row) return
      const watcher = this.toWatcher(row)
      const task = this.task(watcher.taskId)
      this.sql('delete from watchers where id = ?').run(id)
      const waiting = task.state === 'waiting'
      this.insertUpdate(task, {
        kind: waiting ? 'question' : 'info',
        body: `The watcher on "${watcher.what}" expired with nothing new.${waiting ? ' Chase, wait longer (a new watcher), or close?' : ''}`,
        author: 'system',
      })
      this.touch(task, {})
    })
  }

  updateTask(id: string): string {
    return this.update(id).taskId
  }

  // ── signals ───────────────────────────────────────────────────────────────

  matchItems(input: In<typeof MatchItems>) {
    const seen = new Map<string, Task>()
    for (const query of input.queries) {
      const like = `%${query.replace(/[%_]/g, '')}%`
      const rows = this.db
        .prepare(`select * from tasks where ${ACTIVE} and (source_url = ? or title like ? or links like ? or brief like ?) limit 20`)
        .all(query, like, like, like) as Row[]
      for (const row of rows) seen.set(str(row.id), this.toTask(row))
    }
    return {
      tasks: [...seen.values()].map((t) => ({
        id: t.id,
        title: t.title,
        workstream: t.workstream,
        state: t.state,
        sourceUrl: t.source.url,
        links: t.links,
      })),
    }
  }

  fileItem(input: In<typeof FileItem>): Decision {
    return this.idempotent(input.idempotencyKey, 'items.file', () => {
      const { item } = input
      let action = input.action
      let taskId = input.taskId ?? null
      // Never file the same thread or team ticket twice: an active task with it becomes an update.
      const existing = (
        item.ticket
          ? this.sql(`select id from tasks where ${ACTIVE} and mirrors = ?`).get(item.ticket.id)
          : this.sql(`select id from tasks where ${ACTIVE} and source_url = ?`).get(item.url)
      ) as Row | undefined
      if (existing && (action === 'create' || item.ticket)) {
        action = action === 'drop' && !item.ticket?.closed ? 'drop' : 'update'
        taskId = str(existing.id)
      }
      // A closed ticket with no mirror needs no task.
      if (action === 'create' && item.ticket?.closed) action = 'drop'
      if (action === 'create') {
        const task = this.insertTask({
          title: item.title,
          brief: `${item.summary}\n\nFrom: ${item.sender} · ${item.channel} · ${item.at}\nSource: ${item.url}`,
          workstream: input.workstream ?? this.defaultWorkstream,
          priority: input.priority ?? 3,
          state: 'new',
          source: { signal: item.signal, url: item.url, mirrors: item.ticket?.id ?? null },
          links: [{ url: item.url, title: `${item.signal}: ${item.title}`.slice(0, 200) }],
          createdBy: 'signal',
        })
        taskId = task.id
      } else if (action === 'update') {
        if (!taskId) throw new DomainError('BAD_REQUEST', { field: 'taskId' }, 'An update needs the task it belongs to')
        const task = this.task(taskId)
        this.assertOpen(task)
        this.insertUpdate(task, {
          kind: 'signal',
          body: input.note || item.summary,
          author: 'signal',
          attachments: [{ url: item.url, title: `${item.sender} · ${item.channel}`.slice(0, 200) }],
        })
        const links = task.links.some((l) => l.url === item.url)
          ? task.links
          : [...task.links, { url: item.url, title: `${item.signal}: ${item.title}`.slice(0, 200) }]
        const touched = this.touch(task, { links })
        if (item.ticket?.closed && task.source.mirrors === item.ticket.id) {
          this.insertUpdate(touched, { kind: 'done', body: `${item.ticket.id} was closed.`, author: 'system' })
          this.close(this.task(task.id), 'done')
        }
      }
      const decision: Decision = {
        id: newId(),
        signal: item.signal,
        at: this.iso(),
        action: action === 'create' ? 'created' : action === 'update' ? 'updated' : 'dropped',
        taskId,
        reason: input.reason,
        searches: input.searches,
        gated: input.gated,
      }
      this.db
        .prepare(
          'insert into decisions (id, signal, at, action, task_id, reason, searches, gated, item) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          decision.id,
          decision.signal,
          decision.at,
          decision.action,
          decision.taskId,
          decision.reason,
          json(decision.searches),
          decision.gated ? 1 : 0,
          json(item),
        )
      return decision
    })
  }

  // ── sessions (used by the launcher) ───────────────────────────────────────

  recordSession(s: Omit<Session, 'startedAt' | 'lastActivityAt' | 'activity'> & { pid: number | null }): Session {
    return this.transaction(() => {
      const at = this.iso()
      this.db
        .prepare(
          `insert into sessions (id, task_id, machine_id, cwd, branch, resume_url, remote_control_url, state, pid, started_at, last_activity_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(s.id, s.taskId, s.machineId, s.cwd, s.branch, s.resumeUrl, s.remoteControlUrl, s.state, s.pid, at, at)
      const task = this.task(s.taskId)
      this.saveTask({ ...task, sessionId: s.id, updatedAt: at })
      const session = this.session(s.id)
      if (!session) throw new DomainError('NOT_FOUND', { entity: 'session', id: s.id })
      this.emit({ type: 'session.changed', session })
      return session
    })
  }

  setSession(id: string, changes: { state?: SessionState; activity?: string | null; remoteControlUrl?: string | null }): Session {
    return this.transaction(() => {
      const current = this.session(id)
      if (!current) throw new DomainError('NOT_FOUND', { entity: 'session', id })
      const next = { ...current, ...changes, lastActivityAt: this.iso() }
      this.db
        .prepare('update sessions set state = ?, activity = ?, remote_control_url = ?, last_activity_at = ? where id = ?')
        .run(next.state, next.activity, next.remoteControlUrl, next.lastActivityAt, id)
      this.emit({ type: 'session.changed', session: next })
      return next
    })
  }

  /** A session's hooks report what it is doing. */
  reportSession(input: In<typeof ReportSession>): Session {
    return this.idempotent(input.idempotencyKey, 'sessions.report', () => {
      const task = this.task(input.taskId)
      if (!task.sessionId) throw new DomainError('NOT_FOUND', { entity: 'session', id: task.id })
      return this.setSession(task.sessionId, {
        state: input.state,
        ...(input.activity === undefined ? {} : { activity: input.activity }),
      })
    })
  }

  /** Sessions whose process is gone (e.g. after a restart) are marked ended. Returns their tasks. */
  endOrphanedSessions(alive: (session: Session) => boolean): string[] {
    const rows = this.sql(`select * from sessions where state != 'ended'`).all() as Row[]
    const ended: string[] = []
    for (const row of rows) {
      const session = this.toSession(row)
      if (alive(session)) continue
      this.setSession(session.id, { state: 'ended', activity: null })
      ended.push(session.taskId)
    }
    return ended
  }

  /** Autopilot itself says something on a task, e.g. that a session could not start. */
  /** A task from Autopilot itself, in the `autopilot` workstream, on the owner's turn. */
  systemTask(title: string, body: string): Task {
    return this.transaction(() => {
      const task = this.insertTask({
        title: title.slice(0, 120),
        brief: '',
        workstream: 'autopilot',
        priority: 2,
        state: 'new',
        source: { signal: null, url: null, mirrors: null },
        links: [],
        createdBy: 'system',
      })
      this.insertUpdate(task, { kind: 'blocked', body, author: 'system' })
      return task
    })
  }

  /** Reports a problem once; it stays reported (even if the owner closes the task) until it clears. */
  openHealth(key: string, title: string, body: string): void {
    this.transaction(() => {
      if (this.sql('select 1 from health where key = ?').get(key)) return
      const task = this.systemTask(title, body)
      this.sql('insert into health (key, task_id, opened_at) values (?, ?, ?)').run(key, task.id, this.iso())
    })
  }

  closeHealth(key: string, body: string): void {
    this.transaction(() => {
      const row = this.sql('select task_id from health where key = ?').get(key) as Row | undefined
      if (!row) return
      this.sql('delete from health where key = ?').run(key)
      const task = this.task(str(row.task_id))
      if (task.state === 'done' || task.state === 'canceled') return
      this.insertUpdate(task, { kind: 'done', body, author: 'system' })
      this.close(this.task(task.id), 'done')
    })
  }

  systemUpdate(taskId: string, kind: 'blocked' | 'info', body: string, attachments: Link[] = []): Update {
    return this.transaction(() => {
      const task = this.task(taskId)
      const update = this.insertUpdate(task, { kind, body, author: 'system', attachments })
      this.touch(task, {})
      return update
    })
  }

  // ── outbox (side effects after commit) ────────────────────────────────────

  pendingOutbox(limit = 20): OutboxItem[] {
    const rows = this.db
      .prepare('select id, kind, payload, attempts from outbox where done_at is null order by id limit ?')
      .all(limit) as Row[]
    return rows.map((r) => ({
      id: Number(r.id),
      kind: str(r.kind) as OutboxKind,
      payload: parse<OutboxItem['payload']>(r.payload),
      attempts: Number(r.attempts),
    }))
  }

  finishOutbox(id: number, error?: string): void {
    if (error === undefined) {
      this.sql('update outbox set done_at = ?, error = null where id = ?').run(this.iso(), id)
    } else {
      this.sql('update outbox set attempts = attempts + 1, error = ? where id = ?').run(error, id)
    }
  }

  /** Leave an item for a later pass without counting it as a failure (e.g. the session is busy). */
  deferOutbox(id: number): void {
    this.sql('update outbox set error = ? where id = ?').run('deferred', id)
  }

  // ── tokens ────────────────────────────────────────────────────────────────

  createToken(input: In<typeof CreateToken>): { token: Token; secret: string } {
    return this.idempotent(
      input.idempotencyKey,
      'tokens.create',
      () => this.issueToken(input.name, input.scope, input.taskId ?? null),
      (result) => ({ ...result, secret: '' }),
    )
  }

  /** Issues a token outside the API, e.g. the owner's first token or a session's own token. */
  issueToken(name: string, scope: Scope, taskId: string | null): { token: Token; secret: string } {
    const secret = `ap_${scope}_${randomBytes(24).toString('base64url')}`
    const id = newId()
    this.db
      .prepare('insert into tokens (id, name, scope, task_id, secret_hash, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(id, name, scope, taskId, hashSecret(secret), this.iso())
    return { token: this.toToken(this.sql('select * from tokens where id = ?').get(id) as Row), secret }
  }

  // ── devices ───────────────────────────────────────────────────────────────

  /** Failed pairing attempts since the last good one; too many cancels every open code. */
  private pairingFailures = 0

  private toDevice(r: Row): Device {
    return {
      id: str(r.id),
      name: str(r.name),
      kind: str(r.kind) as Device['kind'],
      createdAt: str(r.created_at),
      lastSeenAt: strOrNull(r.last_seen_at),
    }
  }

  listDevices(): Device[] {
    return (this.sql('select * from devices order by created_at').all() as Row[]).map((r) => this.toDevice(r))
  }

  /** A code of eight letters and digits without look-alikes, valid five minutes, usable once. */
  newPairingCode(): { code: string; expiresAt: string } {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const code = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('')
    const expiresAt = new Date(this.now().getTime() + 5 * 60_000).toISOString()
    this.sql('insert into pairing_codes (code_hash, expires_at) values (?, ?)').run(hashSecret(code), expiresAt)
    this.pairingFailures = 0
    return { code, expiresAt }
  }

  /**
   * Not replayable: a lost answer means pairing again with a new code, since the token is returned
   * only once and never stored.
   */
  pairDevice(input: In<typeof PairDevice>): { device: Device; token: string } {
    const paired = this.transaction(() => {
      const row = this.db
        .prepare('select * from pairing_codes where code_hash = ? and used_at is null and expires_at > ?')
        .get(hashSecret(input.code.trim().toUpperCase()), this.iso()) as Row | undefined
      if (!row) return null
      this.sql('update pairing_codes set used_at = ? where code_hash = ?').run(this.iso(), str(row.code_hash))
      const { token, secret } = this.issueToken(`${input.name} (${input.kind})`, 'owner', null)
      const id = newId()
      this.db
        .prepare('insert into devices (id, name, kind, token_id, created_at) values (?, ?, ?, ?, ?)')
        .run(id, input.name, input.kind, token.id, this.iso())
      return { device: this.toDevice(this.sql('select * from devices where id = ?').get(id) as Row), token: secret }
    })
    if (paired) return paired
    // Codes are 40 bits; twenty wrong guesses close every open code all the same.
    if (++this.pairingFailures >= 20) this.sql('update pairing_codes set used_at = ? where used_at is null').run(this.iso())
    throw new DomainError('FORBIDDEN', { needs: ['owner'], has: null }, 'That pairing code is wrong or has expired')
  }

  removeDevice(input: { idempotencyKey: string; id: string }): Record<string, never> {
    return this.idempotent(input.idempotencyKey, 'devices.remove', () => {
      const row = this.sql('select token_id from devices where id = ?').get(input.id) as Row | undefined
      if (!row) return {}
      this.sql('update tokens set revoked_at = ? where id = ?').run(this.iso(), str(row.token_id))
      this.sql('delete from devices where id = ?').run(input.id)
      return {}
    })
  }

  revokeToken(input: { idempotencyKey: string; id: string }): Record<string, never> {
    return this.idempotent(input.idempotencyKey, 'tokens.revoke', () => {
      this.sql('update tokens set revoked_at = ? where id = ?').run(this.iso(), input.id)
      return {}
    })
  }

  revokeTaskTokens(taskId: string): void {
    this.sql('update tokens set revoked_at = ? where task_id = ? and revoked_at is null').run(this.iso(), taskId)
  }

  listTokens(): Token[] {
    return (this.sql('select * from tokens where revoked_at is null order by created_at').all() as Row[]).map((r) => this.toToken(r))
  }

  authenticate(secret: string): Principal | null {
    const row = this.db.prepare('select * from tokens where secret_hash = ? and revoked_at is null').get(hashSecret(secret)) as
      Row | undefined
    if (!row) return null
    this.sql('update tokens set last_used_at = ? where id = ?').run(this.iso(), str(row.id))
    this.sql('update devices set last_seen_at = ? where token_id = ?').run(this.iso(), str(row.id))
    return { tokenId: str(row.id), name: str(row.name), scope: str(row.scope) as Scope, taskId: strOrNull(row.task_id) }
  }
}
