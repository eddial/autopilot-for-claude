import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileItem } from '@autopilot/contracts'
import { openDatabase } from '../src/db.ts'
import { resolvePaths } from '../src/paths.ts'
import { Routing } from '../src/routing.ts'
import { Service } from '../src/service.ts'

let n = 0
const key = () => `key-${++n}-padding`

const setup = (reply: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-route-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(join(paths.home, 'workstreams'), { recursive: true })
  writeFileSync(join(paths.home, 'workstreams', 'customers.md'), '## Routing\nCustomer questions.\nUrgent: a deal closing today.\n')
  const service = new Service({ db: openDatabase(':memory:'), now: () => new Date('2026-10-25T03:30:00Z') })
  const prompts: string[] = []
  const routing = new Routing({
    service,
    paths,
    owner: 'Badr',
    runClaude: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve(reply)
    },
  })
  return { service, routing, paths, prompts }
}

const file = (service: Service, title: string) =>
  service.fileItem(
    FileItem.parse({
      idempotencyKey: key(),
      item: { signal: 'slack', url: `https://example.slack.com/archives/C1/p${++n}`, sender: 'Joris', channel: '#sales', at: '2026-10-25T01:00:00Z', title, summary: title },
      action: 'create',
      workstream: 'customers',
      reason: 'customer question',
      searches: ['x'],
      gated: false,
    }),
  )

describe('routing review', () => {
  it('turns re-filed tasks into a proposal that edits the routing once accepted', async () => {
    const before = 'Customer questions.'
    const after = 'Customer questions, except security questionnaires (legal).'
    const { service, routing, paths, prompts } = setup({
      proposals: [
        { reason: 'Security questionnaires re-filed to legal twice', changes: [{ file: 'workstreams/customers.md', before, after }] },
        { reason: 'Edits a file that is not there', changes: [{ file: '../config.md', before: 'x', after: 'y' }] },
      ],
    })
    for (const title of ['Fill in the Acme security questionnaire', 'Fill in the Initech security questionnaire']) {
      const id = file(service, title).taskId ?? ''
      service.editTask({ idempotencyKey: key(), id, workstream: 'legal' })
    }

    const proposals = await routing.review()
    expect(prompts[0]).toContain('"before": "customers"')
    expect(proposals.map((p) => p.reason)).toEqual(['Security questionnaires re-filed to legal twice'])
    expect(service.queue({ workstream: 'autopilot' }).items.map((i) => i.band)).toEqual(['your_turn'])

    service.decideProposal({ idempotencyKey: key(), proposalId: proposals[0]?.id ?? '', accept: true }, (c) => routing.apply(c))
    expect(readFileSync(join(paths.home, 'workstreams', 'customers.md'), 'utf8')).toContain(after)
    expect(service.queue({ workstream: 'autopilot' }).items).toEqual([])
  })

  it('does not run without corrections', async () => {
    const { routing, prompts } = setup({ proposals: [] })
    expect(await routing.review()).toEqual([])
    expect(prompts).toEqual([])
  })
})
