import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../src/service.ts'
import { resolvePaths } from '../src/paths.ts'
import { Setup } from '../src/setup.ts'

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', 'examples', 'home')

describe('onboarding set-up', () => {
  it('adds an example signal with its placeholders filled, and saves a workstream beside its Work section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-setup-'))
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    const setup = new Setup({ paths, examples: EXAMPLES, claude: 'claude' })

    expect(setup.signalExamples().find((s) => s.name === 'slack')).toMatchObject({ fields: ['YOUR_SLACK_USER_ID'], added: false })
    expect(() => setup.addSignal('slack', {})).toThrow(DomainError)
    setup.addSignal('slack', { YOUR_SLACK_USER_ID: 'U0123' })
    const slack = readFileSync(join(paths.home, 'signals', 'slack.md'), 'utf8')
    expect(slack).toContain('<@U0123>')
    expect(slack).toMatch(/^paused: true$/m)

    const saved = setup.saveWorkstream({ name: 'engineering', routing: 'Pull requests and bugs.', urgent: 'prod down', repo: '~/code/product' })
    expect(saved).toMatchObject({ routing: 'Pull requests and bugs.', urgent: 'prod down' })
    expect(saved.work).toContain('failing test first')
    // Every home gets the autopilot workstream, for health and routing proposals.
    expect(readFileSync(join(paths.home, 'workstreams', 'autopilot.md'), 'utf8')).toContain('## Routing')
  })
})
