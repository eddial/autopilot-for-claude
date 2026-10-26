import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
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

/** A status tab, not a button of the same name in the open task. */
const tab = (name: string) => page.getByRole('navigation', { name: 'Queue' }).getByRole('button', { name })

/** Needs me as itself, not every open task. */
const needsMe = () => tab('Needs me').click()

/** A task with a question waiting on you. */
const asking = (title: string, n: number) => {
  const task = server.service.createTask(CreateTask.parse({ idempotencyKey: `ui-stay-${n}`, title, start: false }), 'owner')
  server.service.postUpdate(
    PostUpdate.parse({ idempotencyKey: `ui-stay-ask-${n}`, taskId: task.id, kind: 'question', body: 'Which?' }),
    'session',
  )
  return task
}

describe('the Mac app window', () => {
  it('creates a task, shows the session asking, and answers it with one click', async () => {
    await expect.poll(() => page.getByRole('heading', { name: 'Needs me' }).isVisible()).toBe(true)
    // The tokens reached the page: the window is its own dark colour, not the browser's white.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(31, 30, 29)')

    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('Title').fill('Decide on prompt caching for agent-service')
    await page.getByLabel('Brief').fill('Measure Opus first; do not touch prod.')
    await page.getByRole('button', { name: 'Automatic' }).click()
    await page.getByRole('menuitemradio', { name: 'engineering' }).click()
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
    // The row says what is asked, in the session's words.
    await expect.poll(() => row.textContent()).toContain('Caching works on staging')
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
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    const heading = page.getByRole('heading', { level: 2, name: 'Renew the office lease' })
    await expect.poll(() => heading.count()).toBe(1)
    await tab('Snoozed').click()
    await expect.poll(() => heading.count()).toBe(0)
  }, 30_000)

  it('keeps what you were typing when the window restarts', async () => {
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    await page.getByLabel('Reply to Autopilot').fill('Half an answer about the lease')
    await page.reload()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    await expect.poll(() => page.getByLabel('Reply to Autopilot').inputValue()).toBe('Half an answer about the lease')
  }, 30_000)

  it("changes a task's priority from its properties", async () => {
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    const side = page.getByRole('complementary', { name: 'Properties' })
    await side.getByRole('button', { name: 'Normal' }).click()
    await side.getByRole('menuitem', { name: 'Urgent' }).click()
    const task = server.service.queue().items.find((i) => i.task.title === 'Renew the office lease')?.task.id ?? ''
    await expect.poll(() => server.service.getTask(task).task.priority).toBe(1)
  }, 30_000)

  it('shows every open task across workstreams under All', async () => {
    await tab('Running').click()
    await expect.poll(() => page.getByRole('heading', { name: 'Running' }).isVisible()).toBe(true)
    await tab('All open').click()
    await expect.poll(() => page.getByRole('option', { name: /Renew the office lease/ }).count()).toBe(1)
    await tab('Running').click()
    await expect.poll(() => page.getByRole('heading', { name: 'Running' }).isVisible()).toBe(true)
  }, 30_000)

  it('walks into set-up the first time', async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect.poll(() => page.getByRole('heading', { name: "Hi, I'm your pilot." }).isVisible()).toBe(true)
    // No Claude Code here: the first check says so, and Continue waits for it.
    await expect.poll(() => page.getByRole('button', { name: 'Continue' }).isDisabled()).toBe(true)
    await shot('setup')
  }, 30_000)

  it('pairs an iPhone from the Devices settings', async () => {
    await page.getByRole('button', { name: 'Skip to settings' }).click()
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Devices' }).click()
    await page.getByRole('button', { name: 'Pair a device' }).click()
    await expect.poll(() => page.getByText('Waiting for your phone').isVisible()).toBe(true)
    await shot('pairing')
    const code = (await page.getByText(/^Or type the code:/).textContent())?.replace('Or type the code:', '').trim() ?? ''
    server.service.pairDevice({ idempotencyKey: 'ui-pair-1', code, name: 'Badr’s iPhone', kind: 'iphone' })
    await expect.poll(() => page.getByText('Paired with Badr’s iPhone.').isVisible(), { timeout: 10_000 }).toBe(true)
  }, 30_000)

  it('closes Settings with Escape and opens a task picked after', async () => {
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count()).toBe(0)
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    await expect.poll(() => page.getByRole('heading', { level: 2, name: 'Renew the office lease' }).count()).toBe(1)
  }, 30_000)

  it('sends a file dropped on the reply with it, kept for the session', async () => {
    server.service.createTask(CreateTask.parse({ idempotencyKey: 'ui-create-file', title: 'Check the lease terms', start: false }), 'owner')
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Check the lease terms/ }).click()
    const files = await page.evaluateHandle(() => {
      const data = new DataTransfer()
      data.items.add(new File(['lease terms'], 'lease.txt', { type: 'text/plain' }))
      return data
    })
    await page.locator('.composer-box').dispatchEvent('drop', { dataTransfer: files })
    // The chip says its size once the file is on the Mac; then it goes with the reply.
    await expect.poll(() => page.locator('.file-chip').textContent()).toContain('1 KB')
    await page.getByRole('button', { name: 'Send' }).click()
    const task = server.service.queue().items.find((i) => i.task.title === 'Check the lease terms')?.task.id ?? ''
    const sent = () => server.service.getTask(task).updates.findLast((u) => u.kind === 'instruction')
    await expect.poll(() => sent()?.attachments.map((a) => a.title)).toEqual(['lease.txt'])
    expect(readFileSync(fileURLToPath(sent()?.attachments[0]?.url ?? ''), 'utf8')).toBe('lease terms')
  }, 30_000)

  it('stays on a task after answering it, and moves on when asked', async () => {
    asking('Pick a venue', 1)
    asking('Pick a caterer', 2)
    await needsMe()
    await page.getByRole('option', { name: /Pick a venue/ }).click()
    await page.getByRole('textbox', { name: 'Reply to Autopilot' }).fill('The barn')
    await page.keyboard.press('Enter')
    // Answered, it runs: still open, still in its place in the list, until you move on.
    await expect.poll(() => page.locator('.row.left').textContent()).toContain('Pick a venue')
    await expect.poll(() => page.getByRole('heading', { level: 2, name: 'Pick a venue' }).count()).toBe(1)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.getByRole('heading', { level: 2, name: 'Pick a caterer' }).count()).toBe(1)
    await expect.poll(() => page.locator('.row.left').count()).toBe(0)
  }, 30_000)
})
