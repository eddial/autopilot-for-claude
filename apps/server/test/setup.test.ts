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

  it('reads an Urgent line that wraps, without leaving its end in the routing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-setup-'))
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    const company = new Setup({ paths, examples: EXAMPLES, claude: 'claude' }).workstreamExamples().find((w) => w.name === 'company')
    expect(company?.urgent).toBe('an investor, board or legal deadline within 24 hours, or a candidate offer about to lapse.')
    expect(company?.routing).not.toContain('lapse')
  })

  it('edits a workstream in place, takes its repository away, and sets it aside', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-setup-'))
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    const setup = new Setup({ paths, examples: EXAMPLES, claude: 'claude' })
    const repo = join(dir, 'product')
    execFileSync('git', ['init', '-q', repo])
    setup.saveWorkstream({ name: 'research', routing: 'Market research.', urgent: '', repo })
    const edited = setup.saveWorkstream({
      name: 'research',
      routing: 'Market and user research.',
      urgent: 'a board meeting this week',
      repo: '',
      work: 'Write it up as a memo.',
      autonomy: 3,
    })
    expect(edited).toMatchObject({
      routing: 'Market and user research.',
      urgent: 'a board meeting this week',
      repo: null,
      work: 'Write it up as a memo.',
      autonomy: 3,
    })

    expect(() => setup.removeWorkstream('research', 2)).toThrow(DomainError)
    expect(setup.removeWorkstream('research', 0).map((w) => w.name)).not.toContain('research')
    expect(() => setup.removeWorkstream('autopilot', 0)).toThrow(DomainError)
  })
})
