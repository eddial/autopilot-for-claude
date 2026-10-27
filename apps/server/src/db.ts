import { DatabaseSync } from 'node:sqlite'

/**
 * The schema. Normal tables for current state, an append-only `updates`
 * table, a numbered `changes` feed written in the same transaction as every
 * write, `applied` for idempotency keys, and an `outbox` for side effects that
 * run after commit (docs/decisions/0003-storage.md).
 *
 * Migrations only ever append; `user_version` records how many have run.
 */
/** A team ticket a title names at its end, as sessions wrote them: `Cap trial accounts at €10 usage (LLE-16161)`. */
const TICKET_IN_TITLE = /\(([A-Z][A-Z0-9]*-\d+)\)\s*$/

/**
 * Active tasks that name their ticket in the title but do not mirror it, because a session filed
 * them: they mirror it now, so the ticket's signal finds them and its closing closes them. A ticket
 * another task already mirrors stays with that task. Returns the tasks it changed.
 */
export const backfillMirrors = (db: DatabaseSync): { id: string; mirrors: string }[] => {
  const rows = db.prepare(`select id, title from tasks where state not in ('done', 'canceled') and mirrors is null order by num`).all() as {
    id: string
    title: string
  }[]
  const taken = db.prepare('select 1 from tasks where mirrors = ?')
  const set = db.prepare('update tasks set mirrors = ? where id = ?')
  const changed: { id: string; mirrors: string }[] = []
  for (const row of rows) {
    const ticket = TICKET_IN_TITLE.exec(row.title)?.[1]
    if (!ticket || taken.get(ticket)) continue
    set.run(ticket, row.id)
    changed.push({ id: row.id, mirrors: ticket })
  }
  return changed
}

/** A migration is SQL, or a function for what SQL cannot say. */
const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
  `
  create table tasks (
    id text primary key,
    num integer not null,
    title text not null,
    brief text not null,
    workstream text not null,
    priority integer not null,
    state text not null,
    snoozed_until text,
    source_signal text,
    source_url text,
    mirrors text,
    links text not null default '[]',
    session_id text,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    seen_at text
  );
  create index tasks_state on tasks(state);
  create index tasks_source_url on tasks(source_url);

  create table updates (
    id text primary key,
    task_id text not null references tasks(id),
    kind text not null,
    body text not null,
    options text not null default '[]',
    waiting_on text,
    attachments text not null default '[]',
    author text not null,
    answers text,
    open integer not null default 0,
    created_at text not null
  );
  create index updates_task on updates(task_id, created_at);

  create table sessions (
    id text primary key,
    task_id text not null references tasks(id),
    machine_id text not null,
    cwd text not null,
    branch text,
    resume_url text,
    remote_control_url text,
    state text not null,
    activity text,
    pid integer,
    started_at text not null,
    last_activity_at text not null
  );

  create table watchers (
    id text primary key,
    task_id text not null references tasks(id),
    what text not null,
    every text not null,
    until text not null,
    tools text not null default '[]',
    fingerprint text,
    last_checked_at text
  );

  create table tokens (
    id text primary key,
    name text not null,
    scope text not null,
    task_id text,
    secret_hash text not null unique,
    created_at text not null,
    last_used_at text,
    revoked_at text
  );

  create table decisions (
    id text primary key,
    signal text not null,
    at text not null,
    action text not null,
    task_id text,
    reason text not null,
    searches text not null default '[]',
    gated integer not null default 0,
    item text not null
  );

  create table signal_state (
    name text primary key,
    last_checked_at text,
    last_run_at text,
    failing_since text,
    message text
  );

  create table changes (
    seq integer primary key autoincrement,
    at text not null,
    type text not null,
    payload text not null
  );

  create table applied (
    key text primary key,
    procedure text not null,
    result text not null,
    at text not null
  );

  create table outbox (
    id integer primary key autoincrement,
    kind text not null,
    payload text not null,
    created_at text not null,
    attempts integer not null default 0,
    error text,
    done_at text
  );
  create index outbox_pending on outbox(done_at, id);
  `,
  `alter table signal_state add column paused integer not null default 0;`,
  `
  alter table signal_state add column failures integer not null default 0;
  -- The open health task per problem (a failing signal), until the problem clears.
  create table health (
    key text primary key,
    task_id text not null references tasks(id),
    opened_at text not null
  );
  `,
  `
  -- What the owner changed on a task a signal filed: what the nightly routing review learns from.
  create table corrections (
    id text primary key,
    at text not null,
    task_id text not null references tasks(id),
    kind text not null,
    before text,
    after text
  );
  create index corrections_at on corrections(at);
  create table routing_proposals (
    id text primary key,
    created_at text not null,
    reason text not null,
    changes text not null,
    state text not null,
    task_id text references tasks(id)
  );
  -- When each of Autopilot's own scheduled jobs last ran.
  create table jobs (
    name text primary key,
    last_run_at text not null
  );
  `,
  `
  -- Phones and other Macs that paired; each has its own owner token.
  create table devices (
    id text primary key,
    name text not null,
    kind text not null,
    token_id text not null references tokens(id),
    created_at text not null,
    last_seen_at text
  );
  -- One-time pairing codes, stored hashed like tokens.
  create table pairing_codes (
    code_hash text primary key,
    expires_at text not null,
    used_at text
  );
  `,
  `
  -- The queue reads every open ask at once.
  create index updates_open on updates(task_id) where open = 1;
  `,
  `
  -- New is called Triage: the state, and the band in the change feed and stored results.
  update tasks set state = 'triage' where state = 'new';
  update changes set payload = replace(replace(payload, '"state":"new"', '"state":"triage"'), '"band":"new"', '"band":"triage"');
  update applied set result = replace(replace(result, '"state":"new"', '"state":"triage"'), '"band":"new"', '"band":"triage"');
  `,
  (db) => void backfillMirrors(db),
]

export const openDatabase = (file: string): DatabaseSync => {
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;')
  const row = db.prepare('pragma user_version').get() as { user_version: number }
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec('begin')
    try {
      const migration = MIGRATIONS[version] ?? ''
      if (typeof migration === 'string') db.exec(migration)
      else migration(db)
      db.exec(`pragma user_version = ${version + 1}`)
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }
  return db
}
