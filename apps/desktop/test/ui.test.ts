import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AttachLink, CreateTask, PostUpdate } from '@autopilot/contracts'
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

    // Something already in Needs me, which the window must not jump to once the new task runs.
    asking('Book the team offsite', 0)
    // And something to triage under it, so Needs me shows both parts.
    server.service.createTask(
      CreateTask.parse({ idempotencyKey: 'ui-create-triage', title: 'Look at the new vendor', start: false }),
      'owner',
    )
    await expect.poll(() => page.getByRole('option', { name: /Book the team offsite/ }).count()).toBe(1)
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('Title').fill('Decide on prompt caching for agent-service')
    await page.getByLabel('Brief').fill('Measure Opus first; do not touch prod.')
    await page.getByRole('button', { name: 'Automatic' }).click()
    await page.getByRole('menuitemradio', { name: 'engineering' }).click()
    await shot('new-task')
    await page.getByRole('button', { name: 'Create and start' }).click()

    // The new task opens, though it runs and so belongs under Running, not Needs me.
    const heading = page.getByRole('heading', { level: 2, name: 'Decide on prompt caching for agent-service' })
    await expect.poll(() => heading.count()).toBe(1)
    const row = page.getByRole('option', { name: /Decide on prompt caching/ })
    const task = server.service.queue().items.find((i) => i.task.title.startsWith('Decide on prompt caching'))?.task
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
    // Answered, it runs and so leaves Needs me, but stays open where it was, so you see the answer land.
    await expect.poll(() => page.locator('.entry').filter({ hasText: 'Opus only' }).count()).toBeGreaterThan(0)
    expect(await page.getByRole('heading', { level: 2, name: 'Decide on prompt caching for agent-service' }).count()).toBe(1)
    await expect.poll(() => page.getByRole('heading', { name: 'Needs me' }).isVisible()).toBe(true)

    await page.setViewportSize({ width: 700, height: 900 })
    await shot('beside-claude')
    await page.getByRole('button', { name: 'Back to the list' }).click()
    await shot('beside-claude-list')
    await page.setViewportSize({ width: 1440, height: 900 })
  }, 60_000)

  it('keeps a task you answer open in Needs me, so you see the answer land', async () => {
    asking('Pick the venue', 7)
    asking('Pick the caterer', 8)
    await needsMe()
    await page.getByRole('option', { name: /Pick the venue/ }).click()
    await page.getByLabel('Reply to Autopilot').fill('The one by the canal')
    await page.keyboard.press('Meta+Enter')
    await expect.poll(() => page.locator('.entry').filter({ hasText: 'The one by the canal' }).count()).toBeGreaterThan(0)
    expect(await page.getByRole('option', { name: /Pick the venue/, selected: true }).count()).toBe(1)
  }, 30_000)

  it('keeps it open too when it was opened under another tab and is still there', async () => {
    asking('Pick the photographer', 9)
    await tab('All open').click()
    await page.getByRole('option', { name: /Pick the photographer/ }).click()
    await needsMe()
    await page.getByLabel('Reply to Autopilot').fill('The one from last year')
    await page.keyboard.press('Meta+Enter')
    await expect.poll(() => page.locator('.entry').filter({ hasText: 'The one from last year' }).count()).toBeGreaterThan(0)
    // Still listed where it was, and still the one open.
    expect(await page.getByRole('option', { name: /Pick the photographer/, selected: true }).count()).toBe(1)
  }, 30_000)

  it('shows the pictures an update attaches, and opens one large', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-shot-'))
    // The smallest PNG there is: one transparent pixel.
    writeFileSync(
      join(dir, 'shot.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
    )
    const task = asking('Look at the screenshots', 10)
    server.service.postUpdate(
      PostUpdate.parse({
        idempotencyKey: 'ui-shot-1',
        taskId: task.id,
        kind: 'review',
        body: 'Screenshots are in.',
        attachments: [{ url: pathToFileURL(join(dir, 'shot.png')).href, title: 'Screenshot: the new node' }],
      }),
      'session',
    )
    await needsMe()
    await page.getByRole('option', { name: /Look at the screenshots/ }).click()
    const thumb = page.getByRole('button', { name: 'Open Screenshot: the new node' })
    // Drawn, not only placed: the window lets the picture in.
    await expect.poll(() => thumb.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await shot('pictures')
    await thumb.click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Screenshot: the new node' }).count()).toBe(1)
    await shot('picture-large')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: 'Screenshot: the new node' }).count()).toBe(0)
  }, 30_000)

  it('switches Auto-fix off for a task with a pull request', async () => {
    const task = asking('Fix the webhook retry', 11)
    server.service.attachLink(
      AttachLink.parse({
        idempotencyKey: 'ui-pr-00001',
        taskId: task.id,
        link: { url: 'https://github.com/acme/api/pull/42', title: 'PR #42' },
      }),
      'session',
    )
    await needsMe()
    await page.getByRole('option', { name: /Fix the webhook retry/ }).click()
    const side = page.getByRole('complementary', { name: 'Properties' })
    await side.getByRole('button', { name: 'On', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Off' }).click()
    await expect.poll(() => server.service.task(task.id).autofix).toBe(false)
  }, 30_000)

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
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    await expect.poll(() => page.getByLabel('Reply to Autopilot').inputValue()).toBe('Half an answer about the lease')
  }, 30_000)

  it("changes a task's priority from its properties", async () => {
    await tab('Needs me').click()
    await page.getByRole('option', { name: /Renew the office lease/ }).click()
    const side = page.getByRole('complementary', { name: 'Properties' })
    await side.getByRole('button', { name: 'Normal' }).click()
    // The menu floats above the page, outside the column.
    await page.getByRole('menuitem', { name: 'Urgent' }).click()
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
    // Tailscale first (loopback stands in for it here), then the code.
    await page.getByRole('button', { name: 'Show the code' }).click()
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

  it('opens a task with one click when the window is narrow', async () => {
    server.service.createTask(CreateTask.parse({ idempotencyKey: 'ui-narrow-1', title: 'Check the narrow window', start: false }), 'owner')
    await page.setViewportSize({ width: 680, height: 900 })
    try {
      // Narrow, an open task hides the list: back to it first.
      const back = page.getByRole('button', { name: 'Back to the list' }).first()
      if (await back.isVisible()) await back.click()
      await tab('Needs me').click()
      await page.getByRole('option', { name: /Check the narrow window/ }).click()
      await expect.poll(() => page.getByRole('heading', { level: 2, name: 'Check the narrow window' }).isVisible()).toBe(true)
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 })
    }
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
