import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CreateTask, Instruct, FileItem, TaskRef } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'
import type { RunClaude } from '../src/signals.ts'
import { TriageSweep, type SweepOutput } from '../src/triage-sweep.ts'

const setup = (reply: (ids: string[]) => SweepOutput) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-sweep-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(join(paths.home, 'signals'), { recursive: true })
  writeFileSync(join(paths.home, 'signals', 'slack.md'), '---\nevery: 1h\ntools: [mcp__slack__search]\n---\nThreads.\n')
  let now = new Date('2026-11-13T12:00:00Z')
  const service = new Service({ db: openDatabase(':memory:'), now: () => now })
  const runs: string[][] = []
  const runClaude: RunClaude = (prompt) => {
    const ids = [...prompt.matchAll(/^## (AP-\d+):/gm)].map((m) => m[1] ?? '')
    runs.push(ids)
    return Promise.resolve(reply(ids))
  }
  const sweep = new TriageSweep({ service, paths, runClaude, owner: 'Badr' })
  const file = (n: number) =>
    service.fileItem(
      FileItem.parse({
        idempotencyKey: `file-item-${n}`,
        item: {
          signal: 'slack',
          url: `https://acme.slack.com/archives/C1/p${n}`,
          sender: 'Sofie',
          channel: '#support',
          at: '2026-11-13T09:00:00Z',
          title: `Question ${n}`,
          summary: 'Sofie asks something.',
        },
        action: 'create',
        workstream: 'customers',
        reason: 'asked Badr',
        searches: [`question ${n}`],
        gated: false,
      }),
    ).taskId ?? ''
  const later = (ms: number) => {
    now = new Date(now.getTime() + ms)
  }
  return { service, sweep, runs, file, later }
}

const resolvedAll = (ids: string[]): SweepOutput => ({
  tasks: ids.map((id) => ({ id, resolved: true, note: 'Tom answered Sofie in the thread on 13 Nov at 10:12.', url: '' })),
})

describe('triage sweep', () => {
  it('closes untouched Triage tasks whose source was resolved, and leaves the rest', async () => {
    const { service, sweep, file } = setup((ids) => ({
      tasks: ids.map((id, i) => ({
        id,
        resolved: i === 0,
        note: i === 0 ? 'Tom answered Sofie in the thread on 13 Nov at 10:12.' : '',
        url: i === 0 ? 'https://acme.slack.com/archives/C1/p1' : '',
      })),
    }))
    const answered = file(1)
    const open = file(2)

    expect(await sweep.sweep()).toEqual([answered])

    const closed = service.getTask(answered)
    expect(closed.task.state).toBe('done')
    expect(closed.updates.at(-1)).toMatchObject({
      kind: 'done',
      author: 'scout',
      body: 'Tom answered Sofie in the thread on 13 Nov at 10:12.',
    })
    expect(closed.updates.at(-1)?.attachments.map((a) => a.url)).toEqual(['https://acme.slack.com/archives/C1/p1'])
    expect(service.getTask(open).task.state).toBe('triage')
  })

  it('never shows or closes what the owner made, started or answered', async () => {
    const { service, sweep, runs, file } = setup(resolvedAll)
    const own = service.createTask(
      CreateTask.parse({ idempotencyKey: 'own-task', title: 'Plan Q1', workstream: 'customers', start: false }),
      'owner',
    )
    const started = file(1)
    service.startTask(TaskRef.parse({ idempotencyKey: 'start-task', id: started }))
    const untouched = file(2)

    await sweep.sweep()

    expect(runs).toEqual([[untouched]])
    expect(service.getTask(own.id).task.state).toBe('triage')
    expect(service.getTask(untouched).task.state).toBe('done')
  })

  it('keeps a task the owner answered while the sweep was looking', async () => {
    let id = ''
    const { service, sweep, file } = setup((ids) => {
      service.instruct(Instruct.parse({ idempotencyKey: 'answer-task', taskId: id, body: 'I will take this one.' }))
      return resolvedAll(ids)
    })
    id = file(1)

    expect(await sweep.sweep()).toEqual([])
    expect(service.getTask(id).task.state).not.toBe('done')
  })

  it('runs once an hour, also across a restart', async () => {
    const { sweep, runs, file, later } = setup(() => ({ tasks: [] }))
    file(1)

    await sweep.tick()
    later(30 * 60_000)
    await sweep.tick()
    expect(runs).toHaveLength(1)

    later(31 * 60_000)
    await sweep.tick()
    expect(runs).toHaveLength(2)
  })
})
