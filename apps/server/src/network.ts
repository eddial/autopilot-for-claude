import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:https'
import { BlockList, isIPv4, Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Route } from '@autopilot/contracts'
import { RPCHandler } from '@orpc/server/node'
import type { Router } from './api.ts'
import type { Service } from './service.ts'
import type { Certificate } from './tls.ts'

export const DEVICE_PORT = 7311

/**
 * Who may connect at all: this Mac and the tailnet. Devices reach the Mac over Tailscale only,
 * at home as anywhere else: not the home network, and nothing from the internet.
 */
const allowed = (() => {
  const list = new BlockList()
  list.addSubnet('127.0.0.0', 8, 'ipv4')
  list.addSubnet('100.64.0.0', 10, 'ipv4')
  list.addAddress('::1', 'ipv6')
  list.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6')
  return list
})()

const TAILSCALE = (() => {
  const list = new BlockList()
  list.addSubnet('100.64.0.0', 10, 'ipv4')
  list.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6')
  return list
})()

export const isAllowedAddress = (address: string | undefined): boolean => {
  if (!address) return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1]
  const ip = mapped ?? address
  return allowed.check(ip, isIPv4(ip) ? 'ipv4' : 'ipv6')
}

/**
 * Where Tailscale's command lives on a Mac. The app's binary acts as the command only when called
 * `tailscale` (lower case); as `Tailscale` it tries to open the app, which fails from a service.
 */
const TAILSCALE_CLI = [
  '/Applications/Tailscale.app/Contents/MacOS/tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  'tailscale',
]

/**
 * This Mac's Tailscale address, or null when Tailscale is not running or not signed in. Asked of
 * Tailscale itself: other VPNs use the same address range. Without its command, the first
 * address in that range.
 */
const readTailnetAddress = (): string | null => {
  for (const cli of TAILSCALE_CLI) {
    try {
      const out = execFileSync(cli, ['ip', '-4'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const first = out.split('\n').find((line) => isIPv4(line.trim()) && TAILSCALE.check(line.trim(), 'ipv4'))
      if (first) return first.trim()
    } catch {
      // Not here, or not running: try the next, then the interfaces.
    }
  }
  for (const addresses of Object.values(networkInterfaces()))
    for (const a of addresses ?? []) if (!a.internal && a.family === 'IPv4' && TAILSCALE.check(a.address, 'ipv4')) return a.address
  return null
}

/** Read at most every ten seconds: the Devices screen asks often, and it rarely changes. */
let lastRead: { at: number; address: string | null } | null = null
export const tailnetAddress = (): string | null => {
  if (!lastRead || Date.now() - lastRead.at > 10_000) lastRead = { at: Date.now(), address: readTailnetAddress() }
  return lastRead.address
}

/** How a device reaches this Mac: its Tailscale address, from anywhere; none without Tailscale. */
export const deviceRoutes = (port: number, address: string | null): Route[] =>
  address ? [{ kind: 'tailscale', address: `${address}:${port}` }] : []

/** The API for paired devices over HTTPS, same router and tokens as the local socket. */
export const listenDevices = async (router: Router, service: Service, certificate: Certificate, port: number): Promise<Server> => {
  const handler = new RPCHandler(router)
  const server = createServer({ key: certificate.key, cert: certificate.cert }, async (req, res) => {
    if (!isAllowedAddress(req.socket.remoteAddress)) {
      res.statusCode = 403
      res.end()
      return
    }
    const header = req.headers.authorization
    const principal = header?.startsWith('Bearer ') ? service.authenticate(header.slice(7)) : null
    const { matched } = await handler.handle(req, res, { prefix: '/rpc', context: { principal } })
    if (!matched) {
      res.statusCode = 404
      res.end('Not found')
    }
  })
  // Connections from elsewhere are dropped before TLS.
  server.on('connection', (socket) => {
    if (socket instanceof Socket && !isAllowedAddress(socket.remoteAddress)) socket.destroy()
  })
  const listen = (host: string) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => resolve())
    })
  // Both IPv4 and IPv6 where the system has IPv6; IPv4 alone where it does not.
  await listen('::').catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EAFNOSUPPORT' && error.code !== 'EADDRNOTAVAIL') throw error
    await listen('0.0.0.0')
  })
  return server
}
