import { join } from 'node:path'
import { CreateTask, PostUpdate } from '@autopilot/contracts'
import { startTestServer, type TestServer } from '@autopilot/testkit'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveWeb } from '../scripts/web-server.ts'

/** Screenshots land here when SCREENSHOTS is set, for looking at the screens without a Mac. */
const SHOTS = process.env.SCREENSHOTS

let server: TestServer
let web: Awaited<ReturnType<typeof serveWeb>>
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await startTestServer({ workstreams: { engineering: '## Routing\nCode.\nUrgent: prod down\n' } })
  web = await serveWeb(server.owner)
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(web.url)
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await web?.close()
  await server?.close()
})

const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

describe('the Mac app window', () => {
  it('creates a task, shows the session asking, and answers it with one click', async () => {
    await expect.poll(() => page.getByRole('heading', { name: 'Needs me' }).isVisible()).toBe(true)
    // The tokens reached the page: the window is its own dark colour, not the browser's white.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(31, 30, 29)')

    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('Title').fill('Decide on prompt caching for agent-service')
    await page.getByLabel('Brief').fill('Measure Opus first; do not touch prod.')
    await page.getByLabel('Workstream').selectOption('engineering')
    await shot('new-task')
    await page.getByRole('button', { name: 'Create and start' }).click()

    const row = page.getByRole('option', { name: /Decide on prompt caching/ })
    await expect.poll(() => row.count()).toBe(0)
    const task = server.service.queue().items[0]?.task
    if (!task) throw new Error('no task created')

    server.service.postUpdate(
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
    await expect
      .poll(() => server.service.getTask(task.id).updates.map((u) => `${u.author}/${u.kind}`))
      .toEqual(['session/decision', 'owner/instruction'])
    await expect.poll(() => page.getByRole('heading', { name: 'Needs me' }).isVisible()).toBe(true)

    await page.setViewportSize({ width: 700, height: 900 })
    await shot('beside-claude')
    await page.getByRole('button', { name: 'Back to the list' }).click()
    await shot('beside-claude-list')
    await page.setViewportSize({ width: 1440, height: 900 })
  }, 60_000)

  it('closes the open task when moving to a list without it', async () => {
    server.service.createTask(CreateTask.parse({ idempotencyKey: 'ui-create-2', title: 'Renew the office lease', start: false }), 'owner')
    await page.getByRole('button', { name: 'Needs me' }).click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    const heading = page.getByRole('heading', { level: 2, name: 'Renew the office lease' })
    await expect.poll(() => heading.count()).toBe(1)
    await page.getByRole('button', { name: 'Snoozed' }).click()
    await expect.poll(() => heading.count()).toBe(0)
  }, 30_000)

  it('shows every open task when the current tab is clicked again', async () => {
    await page.getByRole('button', { name: 'Running' }).click()
    await expect.poll(() => page.getByRole('heading', { name: 'Running' }).isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Running' }).click()
    await expect.poll(() => page.getByRole('option', { name: /Renew the office lease/ }).count()).toBe(1)
    await page.getByRole('button', { name: 'All open' }).click()
    await expect.poll(() => page.getByRole('heading', { name: 'Running' }).isVisible()).toBe(true)
  }, 30_000)

  it('walks into set-up the first time', async () => {
    await page.getByRole('button', { name: 'Set up' }).click()
    await expect.poll(() => page.getByRole('heading', { name: "Hi, I'm your pilot." }).isVisible()).toBe(true)
    // No Claude Code here: the first check says so, and Continue waits for it.
    await expect.poll(() => page.getByRole('button', { name: 'Continue' }).isDisabled()).toBe(true)
    await shot('setup')
  }, 30_000)

  it('pairs an iPhone from the Servers screen', async () => {
    await page.getByRole('button', { name: 'Servers' }).click()
    await page.getByRole('button', { name: 'Pair a device' }).click()
    await expect.poll(() => page.getByText('Waiting for your phone').isVisible()).toBe(true)
    await shot('pairing')
    const code = (await page.getByText(/^Or type the code:/).textContent())?.replace('Or type the code:', '').trim() ?? ''
    server.service.pairDevice({ idempotencyKey: 'ui-pair-1', code, name: 'Badr’s iPhone', kind: 'iphone' })
    await expect.poll(() => page.getByText('Paired with Badr’s iPhone.').isVisible(), { timeout: 10_000 }).toBe(true)
  }, 30_000)
})
