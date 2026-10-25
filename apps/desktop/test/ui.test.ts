import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostUpdate } from '@autopilot/contracts'
import { connect } from '@autopilot/server/client'
import { startServer, type ServerHandle } from '@autopilot/server/main'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths } from '@autopilot/server/paths'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveWeb } from '../scripts/web-server.ts'

/** Screenshots land here when SCREENSHOTS is set, for looking at the screens without a Mac. */
const SHOTS = process.env.SCREENSHOTS

let handle: ServerHandle
let web: Awaited<ReturnType<typeof serveWeb>>
let browser: Browser
let page: Page

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-ui-'))
  const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
  mkdirSync(join(paths.home, 'workstreams'), { recursive: true })
  writeFileSync(join(paths.home, 'workstreams', 'engineering.md'), '## Routing\nCode.\nUrgent: prod down\n')
  handle = await startServer({
    paths,
    self: { node: process.execPath, script: 'autopilot.js' },
    // Set-up checks for Claude Code; here it is never installed.
    claude: join(dir, 'no-claude'),
    runClaude: () => Promise.resolve({ items: [] }),
    // Sessions start, but no Claude Code runs: the test plays the session through the service.
    spawn: () => ({ pid: 1, write: () => {}, kill: () => {}, onData: () => {}, onExit: () => {} }),
    // Any free port for the device listener.
    devicePort: 0,
    log: () => {},
  })
  web = await serveWeb(connect(paths.socket, readOwnerToken(paths) ?? ''))
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(web.url)
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await web?.close()
  await handle?.close()
})

const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

describe('the Mac app window', () => {
  it('creates a task, shows the session asking, and answers it with one click', async () => {
    await expect.poll(() => page.getByRole('heading', { name: 'Needs me' }).isVisible()).toBe(true)

    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('Title').fill('Decide on prompt caching for agent-service')
    await page.getByLabel('Brief').fill('Measure Opus first; do not touch prod.')
    await page.getByLabel('Workstream').selectOption('engineering')
    await shot('new-task')
    await page.getByRole('button', { name: 'Create and start' }).click()

    const row = page.getByRole('option', { name: /Decide on prompt caching/ })
    await expect.poll(() => row.count()).toBe(0)
    const task = handle.service.queue().items[0]?.task
    if (!task) throw new Error('no task created')

    handle.service.postUpdate(
      PostUpdate.parse({
        idempotencyKey: 'ui-decision-1',
        taskId: task.id,
        kind: 'decision',
        body: 'Caching works on staging for all three call sites. Enable it for Opus only, or for every model?',
        options: [
          { id: 'opus', label: 'Opus only' },
          { id: 'all', label: 'Every model' },
        ],
      }),
      'session',
    )
    await expect.poll(() => row.textContent()).toContain('Needs your decision')
    await row.click()
    await expect.poll(() => page.getByRole('button', { name: 'Opus only' }).isVisible()).toBe(true)
    await shot('queue-and-task')

    await page.getByRole('button', { name: 'Opus only' }).click()
    await expect.poll(() => handle.service.getTask(task.id).updates.map((u) => `${u.author}/${u.kind}`)).toEqual(['session/decision', 'owner/instruction'])
    await expect.poll(() => page.getByRole('heading', { name: 'Needs me' }).isVisible()).toBe(true)

    await page.setViewportSize({ width: 700, height: 900 })
    await shot('beside-claude')
    await page.getByRole('button', { name: 'Back to the list' }).click()
    await shot('beside-claude-list')
    await page.setViewportSize({ width: 1440, height: 900 })
  }, 60_000)

  it('shows signals and walks into set-up', async () => {
    await page.getByRole('button', { name: 'Signals' }).click()
    await expect.poll(() => page.getByRole('heading', { name: 'Signals and workstreams' }).isVisible()).toBe(true)
    await shot('signals')
    await page.getByRole('button', { name: 'Set up' }).click()
    await expect.poll(() => page.getByRole('heading', { name: "Hi, I'm your pilot." }).isVisible()).toBe(true)
    // No Claude Code here: the first check says so, and Continue waits for it.
    await expect.poll(() => page.getByRole('button', { name: 'Continue' }).isDisabled()).toBe(true)
    await shot('setup')
  }, 30_000)

  it('pairs an iPhone from the Servers screen', async () => {
    await page.getByRole('button', { name: 'Servers' }).click()
    await page.getByRole('button', { name: 'Pair an iPhone' }).click()
    await expect.poll(() => page.getByText('Waiting for your phone').isVisible()).toBe(true)
    await shot('pairing')
    const code = (await page.getByText(/^Or type the code:/).textContent())?.replace('Or type the code:', '').trim() ?? ''
    handle.service.pairDevice({ idempotencyKey: 'ui-pair-1', code, name: 'Badr’s iPhone', kind: 'iphone' })
    await expect.poll(() => page.getByText('Paired with Badr’s iPhone.').isVisible(), { timeout: 10_000 }).toBe(true)
  }, 30_000)
})
