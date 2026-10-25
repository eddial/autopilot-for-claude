import {
  API_VERSION,
  contract,
  type Author,
  type Decision,
  type Machine,
  type Meta,
  type QueueEvent,
  type Signal,
  type Workstream,
} from '@autopilot/contracts'
import { implement, ORPCError } from '@orpc/server'
import { DomainError, type Principal, type Service } from './service.ts'

export type Context = { principal: Principal | null }

export type SignalsApi = {
  list(): Signal[]
  run(name: string, dryMinutes?: number): Promise<Decision[]>
  pause(name: string, paused: boolean): Signal
}

export type Deps = {
  service: Service
  workstreams: () => Workstream[]
  signals: SignalsApi
  machine: () => Machine
}

const authorOf = (principal: Principal | null): Author => {
  switch (principal?.scope) {
    case 'session':
      return 'session'
    case 'watcher':
      return 'watcher'
    case 'signal':
      return 'signal'
    default:
      return 'owner'
  }
}

/** The task a call is about, for checking a session token's own-task limit. */
const taskOf = (service: Service, path: readonly string[], input: unknown): string | null => {
  const value = (input ?? {}) as Record<string, unknown>
  if (typeof value.taskId === 'string') return value.taskId
  if (path.join('.') === 'watchers.remove' && typeof value.id === 'string') return service.watcherTask(value.id)
  if (path[0] === 'tasks' && typeof value.id === 'string') return value.id
  return null
}

export const createRouter = ({ service, workstreams, signals, machine }: Deps) => {
  const os = implement(contract).$context<Context>()

  /** Every call: check the token against the procedure's scopes, then map domain errors to typed ones. */
  const guarded = os.use(async ({ context, procedure, path, next, errors }, input) => {
    const meta = procedure['~orpc'].meta as Meta
    const principal = context.principal
    if (!meta.public) {
      if (!principal || !meta.scopes.includes(principal.scope)) {
        throw errors.FORBIDDEN({ data: { needs: [...meta.scopes], has: principal?.scope ?? null } })
      }
      if (meta.ownTask && principal.scope === 'session') {
        try {
          const taskId = taskOf(service, path, input)
          if (taskId === null || taskId !== principal.taskId) {
            throw errors.FORBIDDEN({ data: { needs: [...meta.scopes], has: principal.scope } })
          }
        } catch (error) {
          if (error instanceof DomainError) throw errors.FORBIDDEN({ data: { needs: [...meta.scopes], has: principal.scope } })
          throw error
        }
      }
    }
    try {
      return await next()
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      switch (error.code) {
        case 'NOT_FOUND':
          throw errors.NOT_FOUND({ data: error.data as { entity: string; id: string }, message: error.message })
        case 'CONFLICT':
          throw errors.CONFLICT({ data: error.data as { reason: 'already_answered' }, message: error.message })
        case 'SERVICE_UNAVAILABLE':
          throw errors.SERVICE_UNAVAILABLE({
            data: error.data as { what: 'runner'; detail: string },
            message: error.message,
          })
        default:
          throw new ORPCError(error.code, { message: error.message, data: error.data })
      }
    }
  })

  return guarded.router({
    meta: {
      version: guarded.meta.version.handler(() => ({ version: API_VERSION, oldestClient: API_VERSION - 1 })),
    },

    queue: {
      list: guarded.queue.list.handler(({ input }) => service.queue(input)),
      subscribe: guarded.queue.subscribe.handler(async function* ({ input, signal }) {
        let after = input.after
        if (after === undefined) {
          const snapshot = service.queue()
          after = snapshot.seq
          yield { type: 'snapshot', snapshot } satisfies QueueEvent
        }
        for (;;) {
          if (signal?.aborted) return
          const page = service.changesSince(after, 500)
          for (const change of page.changes) yield change
          after = page.changes.at(-1)?.seq ?? after
          if (page.more) continue
          await new Promise<void>((resolve) => {
            const stop = service.onChange(() => {
              stop()
              resolve()
            })
            signal?.addEventListener(
              'abort',
              () => {
                stop()
                resolve()
              },
              { once: true },
            )
          })
        }
      }),
    },

    changes: {
      since: guarded.changes.since.handler(({ input }) => service.changesSince(input.after, input.limit)),
    },

    tasks: {
      get: guarded.tasks.get.handler(({ input }) => service.getTask(input.id)),
      create: guarded.tasks.create.handler(({ input, context }) => service.createTask(input, authorOf(context.principal))),
      edit: guarded.tasks.edit.handler(({ input }) => service.editTask(input)),
      start: guarded.tasks.start.handler(({ input }) => service.startTask(input)),
      snooze: guarded.tasks.snooze.handler(({ input }) => service.snoozeTask(input)),
      wait: guarded.tasks.wait.handler(({ input, context }) => service.waitOn(input, authorOf(context.principal))),
      close: guarded.tasks.close.handler(({ input }) => service.closeTask(input)),
      markSeen: guarded.tasks.markSeen.handler(({ input }) => service.markSeen(input)),
      bulk: guarded.tasks.bulk.handler(({ input }) => service.bulk(input)),
    },

    updates: {
      post: guarded.updates.post.handler(({ input, context }) => service.postUpdate(input, authorOf(context.principal))),
      answer: guarded.updates.answer.handler(({ input }) => service.answerUpdate(input)),
    },

    sessions: {
      report: guarded.sessions.report.handler(({ input }) => service.reportSession(input)),
    },

    links: {
      attach: guarded.links.attach.handler(({ input }) => service.attachLink(input)),
    },

    watchers: {
      add: guarded.watchers.add.handler(({ input }) => service.addWatcher(input)),
      remove: guarded.watchers.remove.handler(({ input }) => service.removeWatcher(input)),
    },

    items: {
      match: guarded.items.match.handler(({ input }) => service.matchItems(input)),
      file: guarded.items.file.handler(({ input }) => service.fileItem(input)),
    },

    routing: {
      list: guarded.routing.list.handler(() => []),
      decide: guarded.routing.decide.handler(({ input }) => {
        throw new DomainError('NOT_FOUND', { entity: 'routing proposal', id: input.proposalId })
      }),
    },

    signals: {
      list: guarded.signals.list.handler(() => signals.list()),
      run: guarded.signals.run.handler(({ input }) => signals.run(input.name, input.dryMinutes)),
      pause: guarded.signals.pause.handler(({ input }) => signals.pause(input.name, input.paused)),
    },

    workstreams: {
      list: guarded.workstreams.list.handler(() => workstreams()),
    },

    machines: {
      list: guarded.machines.list.handler(() => [machine()]),
    },

    devices: {
      list: guarded.devices.list.handler(() => []),
      // Pairing arrives with the iPhone (phase 3).
      pair: guarded.devices.pair.handler(() => {
        throw new DomainError('NOT_FOUND', { entity: 'pairing code', id: '' }, 'Pairing is not available yet')
      }),
      remove: guarded.devices.remove.handler(() => ({})),
    },

    tokens: {
      list: guarded.tokens.list.handler(() => service.listTokens()),
      create: guarded.tokens.create.handler(({ input }) => service.createToken(input)),
      revoke: guarded.tokens.revoke.handler(({ input }) => service.revokeToken(input)),
    },
  })
}

export type Router = ReturnType<typeof createRouter>
