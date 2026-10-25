# 3. SQLite with a change feed, not full event sourcing

**Decision.** Normal tables hold current state. Updates on a task are append-only. Every write adds
rows to a numbered change feed in the same transaction. Every command carries an idempotency key.

**Why.** That is what the asynchronous iPhone needs: an outbox of commands replayed safely, and a
catch-up by sequence number. Full event sourcing would add machinery whose main payoff (moving the
server between machines) is phase 4 and can be done by copying the database.

**Consequences.** History beyond the updates and the change feed is not kept. If it is ever needed,
the change feed is the starting point.

**Update (phase 1a).** The store uses Node's built-in `node:sqlite` with hand-written queries
instead of Drizzle: no native SQLite module to build for Node and again for Electron, and the
queries are few and simple enough that an ORM adds little.
