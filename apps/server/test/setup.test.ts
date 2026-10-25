import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../src/service.ts'
import { resolvePaths } from '../src/paths.ts'
import { Setup } from '../src/setup.ts'

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', 'examples', 'home')

describe('onboarding set-up', () => {
  it('adds an example signal with its placeholders filled, and saves a workstream beside its Work section', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-setup-'))
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    let known: string | null = null
    const setup = new Setup({ paths, examples: EXAMPLES, claude: 'claude', lookup: () => Promise.resolve(known) })

    // Your own Slack user id comes from the connector; nobody is asked to copy it.
    expect(setup.signalExamples().find((s) => s.name === 'slack')).toMatchObject({ fields: [], added: false })
    await expect(setup.addSignal('slack', {})).rejects.toThrow(DomainError)
    known = 'U0123'
    await setup.addSignal('slack', {})
    const slack = readFileSync(join(paths.home, 'signals', 'slack.md'), 'utf8')
    expect(slack).toContain('<@U0123>')
    expect(slack).toMatch(/^paused: true$/m)

    // A repository must be a checkout on this Mac, or every session would fail to start.
    const engineering = { name: 'engineering', routing: 'Pull requests and bugs.', urgent: 'prod down' }
    expect(() => setup.saveWorkstream({ ...engineering, repo: join(dir, 'no-such-repo') })).toThrow(DomainError)
    const repo = join(dir, 'product')
    execFileSync('git', ['init', '-q', repo])
    const saved = setup.saveWorkstream({ ...engineering, repo })
    expect(saved).toMatchObject({ routing: 'Pull requests and bugs.', urgent: 'prod down', repo })
    expect(saved.work).toContain('failing test first')
    // Every home gets the autopilot workstream, for health and routing proposals.
    expect(readFileSync(join(paths.home, 'workstreams', 'autopilot.md'), 'utf8')).toContain('## Routing')
  })
})
