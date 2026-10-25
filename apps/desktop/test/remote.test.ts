import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Link, pair } from '@autopilot/client'
import { nodePinnedFetch } from '@autopilot/client/node'
import { CreateTask } from '@autopilot/contracts'
import { connect } from '@autopilot/server/client'
import { startServer, type ServerHandle } from '@autopilot/server/main'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths } from '@autopilot/server/paths'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { serveWeb } from '../scripts/web-server.ts'

let handle: ServerHandle | undefined
let web: Awaited<ReturnType<typeof serveWeb>> | undefined
let browser: Browser | undefined

afterAll(async () => {
  await browser?.close()
  await web?.close()
  await handle?.close()
})

describe('a MacBook using an always-on Mac (phase 4)', () => {
  it('pairs as a Mac and shows the other Mac’s queue live, over pinned TLS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-remote-'))
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    handle = await startServer({
      paths,
      self: { node: process.execPath, script: 'autopilot.js' },
      claude: join(dir, 'no-claude'),
      runClaude: () => Promise.resolve({ items: [] }),
      spawn: () => ({ pid: 1, write: () => {}, kill: () => {}, onData: () => {}, onExit: () => {} }),
      devicePort: 0,
      log: () => {},
    })
    const { invite } = await connect(paths.socket, readOwnerToken(paths) ?? '').devices.startPairing({ idempotencyKey: 'remote-pairing-1' })
    const local = { ...invite, routes: [{ kind: 'lan' as const, address: `127.0.0.1:${handle.devicePort() ?? 0}` }] }

    // What the MacBook's main process does: pair, then serve the window through the link.
    const pinned = nodePinnedFetch()
    const connection = await pair(local, { name: 'MacBook', kind: 'mac' }, pinned, 'remote-pair-key-1')
    web = await serveWeb(new Link(connection, pinned).api)
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(web.url)
    await expect.poll(() => page.evaluate(() => document.body.dataset.connection)).toBe('live')

    handle.service.createTask(CreateTask.parse({ idempotencyKey: 'remote-task-1', title: 'Renew the domain', start: false, priority: 1 }))
    await expect.poll(() => page.getByRole('option', { name: /Renew the domain/ }).count(), { timeout: 10_000 }).toBe(1)
  }, 60_000)
})
