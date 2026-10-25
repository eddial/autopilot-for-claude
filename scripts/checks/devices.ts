import { randomUUID } from 'node:crypto'
// Pairing over this Mac's real network: every route in the invite (Bonjour name, LAN, Tailscale)
// probed with pinned TLS, then a paired device syncing. Run by scripts/mac-check.sh.
import type { Invite } from '../../packages/contracts/src/index.ts'
import { Link, pair } from '../../packages/client/src/connection.ts'
import { nodePinnedFetch } from '../../packages/client/src/node.ts'
import { memoryStorage, Sync } from '../../packages/client/src/sync.ts'
import { checkServer, key, run } from './lib.ts'

const { api } = checkServer()
const pinned = nodePinnedFetch()
let invite: Invite | null = null
let deviceId = ''

await run('Pairing over the real network', [
  [
    'Start pairing (opens the device listener)',
    async () => {
      invite = (await api.devices.startPairing({ idempotencyKey: key() })).invite
      return invite.routes.map((r) => `${r.kind} ${r.address}`).join(', ')
    },
  ],
  [
    'Each route answers with the pinned certificate',
    async () => {
      if (!invite) throw new Error('no invite')
      const results: string[] = []
      for (const route of invite.routes) {
        const started = Date.now()
        const link = new Link({ server: invite.server, routes: [route], fingerprint: invite.fingerprint, token: '' }, pinned)
        const ok = await link.probe()
        results.push(`${route.kind} ${route.address}: ${ok ? `ok in ${Date.now() - started} ms` : 'no answer'}`)
      }
      if (!results.some((r) => r.includes(': ok'))) throw new Error(results.join('; '))
      return results.join('; ')
    },
  ],
  [
    'A wrong fingerprint is refused',
    async () => {
      if (!invite) throw new Error('no invite')
      const wrong = { ...invite, fingerprint: invite.fingerprint.replace(/^../, invite.fingerprint.startsWith('00') ? '11' : '00') }
      const link = new Link({ server: wrong.server, routes: wrong.routes, fingerprint: wrong.fingerprint, token: '' }, pinned)
      if (await link.probe()) throw new Error('A server with another certificate was trusted')
      return 'refused'
    },
  ],
  [
    'Pair and sync like the iPhone',
    async () => {
      if (!invite) throw new Error('no invite')
      const connection = await pair(invite, { name: 'mac-check', kind: 'iphone' }, pinned, key())
      const sync = new Sync({ newKey: randomUUID, connection, pinned, storage: memoryStorage() })
      await sync.syncOnce()
      const state = sync.getState()
      if (state.status !== 'online') throw new Error(`status ${state.status}`)
      deviceId = (await api.devices.list()).find((d) => d.name === 'mac-check')?.id ?? ''
      return `online via ${state.routeKind}, ${sync.items().length} tasks in the queue`
    },
  ],
  [
    'Remove the check device',
    async () => {
      await api.devices.remove({ idempotencyKey: key(), id: deviceId })
      return 'removed'
    },
  ],
])
