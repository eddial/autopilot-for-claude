import { Link, pair } from '@autopilot/client'
import { nodePinnedFetch } from '@autopilot/client/node'
import { CreateTask } from '@autopilot/contracts'
import { localInvite, startTestServer, type TestServer } from '@autopilot/testkit'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { serveWeb } from '../scripts/web-server.ts'

let server: TestServer | undefined
let web: Awaited<ReturnType<typeof serveWeb>> | undefined
let browser: Browser | undefined

afterAll(async () => {
  await browser?.close()
  await web?.close()
  await server?.close()
})

describe('a MacBook using an always-on Mac (phase 4)', () => {
  it('pairs as a Mac and shows the other Mac’s queue live, over pinned TLS', async () => {
    server = await startTestServer()
    const local = await localInvite(server, 'remote-pairing-1')

    // What the MacBook's main process does: pair, then serve the window through the link.
    const pinned = nodePinnedFetch()
    const connection = await pair(local, { name: 'MacBook', kind: 'mac' }, pinned, 'remote-pair-key-1')
    web = await serveWeb(new Link(connection, pinned).api)
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(web.url)
    await expect.poll(() => page.evaluate(() => document.body.dataset.connection)).toBe('live')

    server.service.createTask(CreateTask.parse({ idempotencyKey: 'remote-task-1', title: 'Renew the domain', start: false, priority: 1 }))
    await expect.poll(() => page.getByRole('option', { name: /Renew the domain/ }).count(), { timeout: 10_000 }).toBe(1)
  }, 60_000)
})
