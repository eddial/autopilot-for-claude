import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AnswerUpdate, AttachLink, CreateTask, PostUpdate } from '@autopilot/contracts'
import { scoutBody } from '@autopilot/server/scout'
import { keys, startTestServer } from '@autopilot/testkit'
import { chromium, type Page } from 'playwright-core'
import { serveWeb } from './web-server.ts'

/**
 * Screenshots of every screen of the Mac window, on a server filled with a realistic day:
 * `pnpm screens [folder]` (default `screens/`). For reviewing the look without a Mac.
 */

const out = resolve(process.argv[2] ?? 'screens')
mkdirSync(out, { recursive: true })

const server = await startTestServer({
  workstreams: {
    engineering: '## Routing\nCode, pull requests, incidents and anything in the agent-service repo.\nUrgent: prod down\n',
    customers: '## Routing\nQuestions and requests from customers in Slack and email.\nUrgent: an enterprise customer is blocked\n',
    operations: '## Routing\nInvoices, contracts, hiring and the office.\n',
  },
})
const { service } = server
const key = keys('screens')

const task = (title: string, workstream: string, brief = '', start = false, priority = 3) =>
  service.createTask(CreateTask.parse({ idempotencyKey: key(), title, brief, workstream, start, priority }))
const post = (taskId: string, kind: 'decision' | 'question' | 'review' | 'info' | 'done', body: string, options: string[] = []) =>
  service.postUpdate(
    PostUpdate.parse({ idempotencyKey: key(), taskId, kind, body, options: options.map((label, i) => ({ id: `o${i}`, label })) }),
    'session',
  )

// Your turn: decisions, a question and a review.
const caching = task('Decide on prompt caching for agent-service', 'engineering', 'Measure Opus first; do not touch prod.', true, 2)
post(caching.id, 'info', 'Measured the three call sites on staging: caching cuts input cost by 71% on the planner and 64% on the reviewer.')
post(caching.id, 'decision', 'Caching works on staging for all three call sites. Enable it for Opus only, or for every model?', [
  'Opus only',
  'Every model',
])
const acme = task('Reply to Acme about the SSO rollout date', 'customers', '', true, 1)
post(
  acme.id,
  'question',
  'Sarah at Acme asks whether SSO ships before their 1 December audit. Engineering says the 24th. Can I promise that?',
)
const pr = task('Review the retry fix for the webhook worker', 'engineering', '', true)
post(
  pr.id,
  'info',
  'Found the cause: the worker retried immediately and hit the rate limit again, so one slow minute cascaded into an hour of failures.',
)
const how = post(pr.id, 'decision', 'Back off exponentially, or queue the retries for the next minute?', ['Back off', 'Queue them'])
service.answerUpdate(AnswerUpdate.parse({ idempotencyKey: key(), updateId: how.id, optionId: 'o0' }))
service.attachLink(
  AttachLink.parse({
    idempotencyKey: key(),
    taskId: pr.id,
    link: { url: 'https://github.com/acme/webhooks/pull/88', title: 'Retry with backoff (draft PR #88)', subtitle: 'CI passing' },
  }),
)
service.attachLink(
  AttachLink.parse({
    idempotencyKey: key(),
    taskId: pr.id,
    link: { url: 'https://acme.slack.com/archives/C042/p1729850000', title: 'Incident thread in #eng-alerts' },
  }),
)
service.addWatcher({
  idempotencyKey: key(),
  taskId: pr.id,
  what: 'reviews on PR #88',
  every: '30m',
  until: new Date(Date.now() + 2 * 86_400_000).toISOString(),
})
post(
  pr.id,
  'review',
  'The draft pull request is ready: retries back off exponentially and stop after five. Tests pass. Have a look before I mark it ready?',
)
const invoice = task('Pay the October Hetzner invoice', 'operations')
post(invoice.id, 'decision', 'The invoice is €412, up from €380 because of the new staging box. Pay it now?', ['Pay it', 'Hold it'])

// New, running, waiting, snoozed, done.
task('Draft the Q4 hiring plan for two engineers', 'operations')
const flaky = task('Look into flaky e2e test on checkout', 'engineering', 'It fails about one run in ten on CI only.')
service.systemUpdate(
  flaky.id,
  'info',
  scoutBody({
    summary:
      'The checkout e2e test failed 6 of the last 50 CI runs, always at the payment step and only on Linux runners. It started the day the Stripe mock moved to a shared container (PR #212).',
    related: [],
    approach: [
      'Reproduce with the shared mock under load',
      'Give each test file its own mock, or wait for its readiness',
      'Run the suite 50 times to confirm',
    ],
    questions: ['Fix it in the test, or move the mock back per job?'],
  }),
  [
    { url: 'https://github.com/acme/shop/pull/212', title: 'github: PR #212, shared Stripe mock' },
    { url: 'https://github.com/acme/shop/actions', title: 'github: the 6 failed runs' },
  ],
  'scout',
)
task('Summarise the customer interviews from last week', 'customers', '', true)
task('Upgrade the Node runtime to 24 in the worker images', 'engineering', '', true)
const waiting = task('Get the signed DPA back from Globex', 'customers', '', true)
service.waitOn({ idempotencyKey: key(), id: waiting.id, on: 'Globex legal' }, 'session')
const sofie = task('Answer Sofie on the SSO dates', 'customers', '', true, 2)
service.postUpdate(
  {
    idempotencyKey: key(),
    taskId: sofie.id,
    kind: 'review',
    body: 'Sofie asks when SSO reaches her team. Engineering says the end of November, so I kept it to that and offered a call.',
    options: [],
    attachments: [],
    draft: {
      channel: 'email',
      to: 'sofie@globex.com',
      subject: 'Re: SSO for the Globex team',
      body: 'Hi Sofie,\n\nSSO reaches your team by the end of November. Happy to walk your IT lead through the setup on a short call that week.\n\nBest,\nBadr',
    },
  },
  'session',
)
// Joris only acknowledged: the review is still his to do, so it is FYI.
const told = task('Get the checkout redesign reviewed', 'engineering', '', true)
service.waitOn(
  {
    idempotencyKey: key(),
    id: told.id,
    on: 'Joris to review',
    watcher: { what: 'PR #214 review', every: '30m', until: new Date(Date.now() + 86_400_000).toISOString(), tools: [] },
  },
  'session',
)
const toldWatcher = service.watcherRuns().find((r) => r.task.id === told.id)?.watcher.id ?? ''
service.watcherNews(toldWatcher, {
  body: 'Joris thanked you and says he will review it on Monday morning.',
  attachments: [{ url: 'https://github.com/acme/shop/pull/214', title: 'GitHub' }],
  wake: false,
  theirs: true,
})
const snoozed = task('Renew the office lease', 'operations')
service.snoozeTask({ idempotencyKey: key(), id: snoozed.id, until: new Date(Date.now() + 3 * 86_400_000).toISOString() })
const done = task('Rotate the Stripe webhook secret', 'engineering', '', true)
post(done.id, 'done', 'Rotated in both environments and verified a test event.')
service.closeTask({ idempotencyKey: key(), id: done.id, outcome: 'done' })

const web = await serveWeb(server.owner)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const shot = async (name: string, p: Page = page) => {
  await p.waitForTimeout(150)
  await p.screenshot({ path: join(out, `${name}.png`) })
  console.log(join(out, `${name}.png`))
}

await page.goto(web.url)
await page.getByRole('heading', { name: 'Needs me' }).waitFor()
await page.getByRole('option', { name: /prompt caching/ }).click()
await page.getByRole('button', { name: 'Opus only' }).waitFor()
await shot('01-needs-me')

await page.getByRole('option', { name: /checkout redesign/ }).click()
await page.getByRole('button', { name: 'Back to waiting' }).waitFor()
await shot('01b-fyi')

await page.getByRole('option', { name: /Sofie on the SSO/ }).click()
await page.getByRole('button', { name: 'Change' }).waitFor()
await shot('01c-draft')

await page.getByRole('option', { name: /Hetzner/ }).click()
await page.keyboard.press('Space')
await shot('02-answer-in-place')
await page.keyboard.press('Escape')

await page.getByRole('option', { name: /retry fix/ }).click()
await page.getByText('Found the cause').waitFor()
await shot('02b-history')

await page.getByRole('option', { name: /flaky e2e/ }).click()
await page.getByText('First look').waitFor()
await shot('03-first-look')

await page.getByRole('button', { name: 'Running' }).click()
await shot('03b-running')
await page.getByLabel('Filter tasks').fill('ws:engineering')
await shot('04-workstream')
await page.getByLabel('Filter tasks').fill('')
await page.getByRole('button', { name: 'New task' }).click()
await shot('05-new-task')
await page.getByRole('button', { name: 'Settings' }).click()
// Not set up yet: the steps first, settings a click away.
const skip = page.getByRole('button', { name: 'Skip to settings' })
if (await skip.isVisible()) await skip.click()
await page.getByRole('region', { name: 'Settings' }).waitFor()
await shot('06-settings')
const settingsTab = (name: string) => page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name })
await settingsTab('Sources').click()
await shot('06b-settings-sources')
await settingsTab('Workstreams').click()
await shot('06c-settings-workstreams')
await settingsTab('Devices').click()
await page.getByRole('button', { name: 'Pair a device' }).click()
await shot('07-devices-tailscale')
await page.getByRole('button', { name: 'Show the code' }).click()
await page.getByText('Waiting for your phone').waitFor()
await shot('07-devices-pairing')
await page.getByRole('button', { name: 'Run set-up again' }).click()
await shot('08-set-up')

// Beside Claude Code: the window at a third of the screen.
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Needs me' }).click()
await page.setViewportSize({ width: 620, height: 900 })
await shot('09-narrow-list')
await page.getByRole('option', { name: /Acme/ }).dblclick()
await shot('10-narrow-task')

await browser.close()
await web.close()
await server.close()
