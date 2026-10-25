import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CreateTask, TaskRef } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { resolvePaths } from '../src/paths.ts'
import { Scout, type ScoutOutput } from '../src/scout.ts'
import { Service } from '../src/service.ts'
import type { RunClaude } from '../src/signals.ts'

const PROMPTS = join(import.meta.dirname, '..', '..', '..', 'prompts')

const REPLY: ScoutOutput = {
  summary: 'Acme asked in #acme-support on Friday; the SSO work is in PR #41, two reviews left.',
  related: [
    { url: 'https://acme.slack.com/archives/C1/p1', title: 'slack: Sarah in #acme-support' },
    { url: 'https://github.com/us/app/pull/41', title: 'github: SSO pull request' },
  ],
  approach: ['Check the PR review state', 'Draft a reply with the date'],
  questions: ['Promise the 24th, or a range?'],
}

const setup = (onRun: () => void = () => {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-scout-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(join(paths.home, 'signals'), { recursive: true })
  writeFileSync(join(paths.home, 'signals', 'slack.md'), '---\nevery: 1h\ntools: [mcp__slack__search]\n---\nThreads.\n')
  const service = new Service({ db: openDatabase(':memory:') })
  const calls: { tools: string[] }[] = []
  const runClaude: RunClaude = (_prompt, options) => {
    calls.push({ tools: options.tools })
    onRun()
    return Promise.resolve(REPLY)
  }
  const scout = new Scout({ service, paths, workstreams: () => [], runClaude, prompts: PROMPTS, owner: 'Badr' })
  const create = (title: string, start: boolean) =>
    service.createTask(CreateTask.parse({ idempotencyKey: `create-${title}`, title, workstream: 'customers', start }), 'owner')
  return { service, scout, calls, create }
}

describe('scout', () => {
  it('gives each new task a first look once, and leaves started tasks to their session', async () => {
    const { service, scout, calls, create } = setup()
    const waiting = create('Reply to Acme about SSO', false)
    const started = create('Upgrade Node', true)

    await scout.tick()
    await scout.tick()

    expect(calls).toEqual([{ tools: ['mcp__slack__search'] }])
    const update = service.getTask(waiting.id).updates.at(-1)
    expect(update).toMatchObject({ author: 'scout', kind: 'info', open: false })
    expect(update?.body).toContain('Likely approach:\n1. Check the PR review state')
    expect(update?.body).toContain('Before starting:\n- Promise the 24th, or a range?')
    expect(update?.attachments.map((a) => a.title)).toEqual(['slack: Sarah in #acme-support', 'github: SSO pull request'])
    // Informing is not asking: the task stays in New.
    expect(service.getTask(waiting.id).band).toBe('new')
    expect(service.getTask(started.id).updates).toEqual([])
  })

  it('posts nothing when the task was started while it looked', async () => {
    let id = ''
    const { service, scout, create } = setup(() => service.startTask(TaskRef.parse({ idempotencyKey: 'start-1', id })))
    id = create('Reply to Acme about SSO', false).id
    await scout.tick()
    expect(service.getTask(id).updates.filter((u) => u.author === 'scout')).toEqual([])
  })
})
