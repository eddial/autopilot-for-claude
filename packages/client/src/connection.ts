import type { contract, Invite, Route } from '@autopilot/contracts'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'

export type Api = ContractRouterClient<typeof contract>

/** What a paired device keeps: how to reach the server, what certificate to trust, and its token. */
export type Connection = {
  server: string
  routes: Route[]
  fingerprint: string
  token: string
}

/**
 * One HTTPS request to `url`, trusting only the certificate with this fingerprint. The phone does
 * it in Swift (URLSession), Node with undici; both reject anything else before sending a byte.
 */
export type PinnedFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string | undefined; signal: AbortSignal | undefined },
  fingerprint: string,
) => Promise<Response>

/** No route answered. */
export class Offline extends Error {
  constructor(message = 'The server cannot be reached') {
    super(message)
    this.name = 'Offline'
  }
}

const PROBE_MS = 3_000

const clientFor = (pinned: PinnedFetch, fingerprint: string, address: () => string | null, token: string | null): Api =>
  createORPCClient(
    new RPCLink({
      url: 'https://autopilot/rpc',
      fetch: async (request) => {
        const host = address()
        if (!host) throw new Offline()
        const url = new URL(request.url)
        const headers: Record<string, string> = {}
        request.headers.forEach((value, key) => {
          headers[key] = value
        })
        if (token) headers.authorization = `Bearer ${token}`
        const body = request.method === 'GET' ? undefined : await request.text()
        return pinned(`https://${host}${url.pathname}${url.search}`, { method: request.method, headers, body, signal: request.signal }, fingerprint)
      },
    }),
  )

/**
 * Reaches a server by the first route that answers, LAN before Tailscale, and stays on it until
 * a call fails; then the next call probes the routes again.
 */
export class Link {
  readonly api: Api
  private current: Route | null = null
  private readonly pinned: PinnedFetch
  private readonly connection: Connection

  constructor(connection: Connection, pinned: PinnedFetch) {
    this.connection = connection
    this.pinned = pinned
    this.api = clientFor(pinned, connection.fingerprint, () => this.current?.address ?? null, connection.token)
  }

  route(): Route | null {
    return this.current
  }

  /** Tries each route in order with a short timeout; returns the one that answered. */
  async probe(): Promise<Route | null> {
    for (const route of this.connection.routes) {
      if (route.kind === 'socket') continue
      const api = clientFor(this.pinned, this.connection.fingerprint, () => route.address, null)
      try {
        await api.meta.version(undefined, { signal: AbortSignal.timeout(PROBE_MS) })
        this.current = route
        return route
      } catch {
        // Next route.
      }
    }
    this.current = null
    return null
  }

  /** After a failed call: the route is in doubt until the next probe. */
  lost(): void {
    this.current = null
  }
}

/** Pairs with the server in an invite: the first route that answers gets the code. */
export const pair = async (invite: Invite, device: { name: string; kind: 'iphone' | 'mac' }, pinned: PinnedFetch, key: string): Promise<Connection> => {
  const link = new Link({ server: invite.server, routes: invite.routes, fingerprint: invite.fingerprint, token: '' }, pinned)
  if (!(await link.probe())) throw new Offline(`${invite.server} cannot be reached on this network`)
  const { token } = await link.api.devices.pair({ idempotencyKey: key, code: invite.code, name: device.name, kind: device.kind })
  return { server: invite.server, routes: invite.routes, fingerprint: invite.fingerprint, token }
}
