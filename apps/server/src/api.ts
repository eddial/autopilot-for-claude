import {
  API_VERSION,
  contract,
  type Author,
  type Decision,
  type SuggestedWorkstream,
  type Detected,
  type Machine,
  type Pairing,
  type Meta,
  QueueEvent,
  type RoutingProposal,
  type Scope,
  type Signal,
  type Workstream,
} from '@autopilot/contracts'
import { implement, ORPCError } from '@orpc/server'
import { DomainError, type Principal, type Service } from './service.ts'
import { previewArtifact } from './artifacts.ts'
import type { Setup } from './setup.ts'

export type Context = { principal: Principal | null }

export type SignalsApi = {
  list(): Signal[]
  run(name: string, dryMinutes?: number): Promise<Decision[]>
  importOpen(name: string, dry: boolean): Promise<Decision[]>
  sweep(names: string[], days: number): Promise<SuggestedWorkstream[]>
  pause(name: string, paused: boolean): Signal
}

export type Deps = {
  service: Service
  workstreams: () => Workstream[]
  signals: SignalsApi
  machine: () => Machine
  /** Writes an accepted routing proposal into the home files. */
  applyRouting: (changes: RoutingProposal['changes']) => void
  detect: () => Promise<Detected>
  setup: Setup
  /** Installs the launchd agent for the server. */
  installService: () => void
  /** Opens the device listener if needed and makes a one-time invite. */
  startPairing: () => Promise<Pairing>
  log?: (message: string) => void
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

export const createRouter = ({
  service,
  workstreams,
  signals,
  machine,
  applyRouting,
  detect,
  setup,
  installService,
  startPairing,
  log = () => {},
}: Deps) => {
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
      if (!(error instanceof DomainError)) {
        log(`${path.join('.')} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
        throw error
      }
      switch (error.code) {
        case 'FORBIDDEN':
          throw errors.FORBIDDEN({ data: error.data as { needs: Scope[]; has: Scope | null }, message: error.message })
        case 'NOT_FOUND':
          throw errors.NOT_FOUND({ data: error.data as { entity: string; id: string }, message: error.message })
        case 'CONFLICT':
          throw errors.CONFLICT({ data: error.data as { reason: 'already_answered' | 'version_mismatch' }, message: error.message })
        case 'SERVICE_UNAVAILABLE':
          throw errors.SERVICE_UNAVAILABLE({
            data: error.data as { what: 'runner' | 'connector' | 'claude'; detail: string },
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
          const event: QueueEvent = { type: 'snapshot', snapshot }
          const checked = QueueEvent.safeParse(event)
          if (!checked.success) log(`queue snapshot does not match the contract: ${JSON.stringify(checked.error.issues)}`)
          yield event
        }
        for (;;) {
          if (signal?.aborted) return
          const page = service.changesSince(after, 500)
          for (const change of page.changes) {
            // An event the contract rejects would end the client's stream; log exactly what was wrong.
            const checked = QueueEvent.safeParse(change)
            if (!checked.success)
              log(
                `queue event ${change.seq} does not match the contract: ${JSON.stringify(checked.error.issues)} ${JSON.stringify(change).slice(0, 2000)}`,
              )
            yield change
          }
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
      since: guarded.changes.since.handler(async ({ input, signal }) => {
        const page = service.changesSince(input.after, input.limit)
        if (page.changes.length > 0 || input.wait === 0) return page
        // Nothing new: hold the call until something changes or the wait runs out.
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            stop()
            resolve()
          }
          const timer = setTimeout(done, input.wait * 1000)
          const stop = service.onChange(done)
          signal?.addEventListener('abort', done, { once: true })
        })
        return service.changesSince(input.after, input.limit)
      }),
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
      instruct: guarded.updates.instruct.handler(({ input }) => service.instruct(input)),
    },

    sessions: {
      report: guarded.sessions.report.handler(({ input }) => service.reportSession(input)),
    },

    links: {
      attach: guarded.links.attach.handler(({ input, context }) => service.attachLink(input, authorOf(context.principal))),
      preview: guarded.links.preview.handler(({ input }) => previewArtifact(service.task(input.taskId), input.url)),
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
      list: guarded.routing.list.handler(() => service.proposals()),
      decide: guarded.routing.decide.handler(({ input }) => service.decideProposal(input, applyRouting)),
    },

    signals: {
      list: guarded.signals.list.handler(() => signals.list()),
      run: guarded.signals.run.handler(({ input }) => signals.run(input.name, input.dryMinutes)),
      import: guarded.signals.import.handler(({ input }) => signals.importOpen(input.name, input.dry)),
      pause: guarded.signals.pause.handler(({ input }) => signals.pause(input.name, input.paused)),
      examples: guarded.signals.examples.handler(() => setup.signalExamples()),
      add: guarded.signals.add.handler(async ({ input }) => {
        await setup.addSignal(input.name, input.values)
        const added = signals.list().find((s) => s.name === input.name)
        if (!added) throw new DomainError('NOT_FOUND', { entity: 'signal', id: input.name })
        return added
      }),
    },

    setup: {
      status: guarded.setup.status.handler(() => setup.status()),
      installService: guarded.setup.installService.handler(() => {
        installService()
        return setup.status()
      }),
    },

    connectors: {
      detect: guarded.connectors.detect.handler(async () => {
        try {
          return await detect()
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          throw new DomainError('SERVICE_UNAVAILABLE', { what: 'claude', detail }, `Claude Code could not be asked: ${detail}`)
        }
      }),
    },

    workstreams: {
      list: guarded.workstreams.list.handler(() => workstreams()),
      examples: guarded.workstreams.examples.handler(() => setup.workstreamExamples()),
      sweep: guarded.workstreams.sweep.handler(({ input }) => signals.sweep(input.signals, input.days)),
      save: guarded.workstreams.save.handler(({ input }) => setup.saveWorkstream(input)),
    },

    machines: {
      list: guarded.machines.list.handler(() => [machine()]),
    },

    devices: {
      list: guarded.devices.list.handler(() => service.listDevices()),
      startPairing: guarded.devices.startPairing.handler(() => startPairing()),
      pair: guarded.devices.pair.handler(({ input }) => service.pairDevice(input)),
      remove: guarded.devices.remove.handler(({ input }) => service.removeDevice(input)),
    },

    tokens: {
      list: guarded.tokens.list.handler(() => service.listTokens()),
      create: guarded.tokens.create.handler(({ input }) => service.createToken(input)),
      revoke: guarded.tokens.revoke.handler(({ input }) => service.revokeToken(input)),
    },
  })
}

export type Router = ReturnType<typeof createRouter>
