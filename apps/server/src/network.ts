import { createServer, type Server } from 'node:https'
import { BlockList, isIPv4, Socket } from 'node:net'
import { hostname, networkInterfaces } from 'node:os'
import type { Route } from '@autopilot/contracts'
import { RPCHandler } from '@orpc/server/node'
import type { Router } from './api.ts'
import type { Service } from './service.ts'
import type { Certificate } from './tls.ts'

export const DEVICE_PORT = 7311

/** Who may connect at all: this Mac, private networks and the tailnet. Nothing from the internet. */
const allowed = (() => {
  const list = new BlockList()
  for (const [net, bits] of [
    ['127.0.0.0', 8],
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['169.254.0.0', 16],
    ['100.64.0.0', 10],
  ] as const)
    list.addSubnet(net, bits, 'ipv4')
  list.addAddress('::1', 'ipv6')
  list.addSubnet('fc00::', 7, 'ipv6')
  list.addSubnet('fe80::', 10, 'ipv6')
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
 * How a device can reach this Mac, best first: its Bonjour name and LAN addresses at home, then
 * its Tailscale address from anywhere.
 */
export const deviceRoutes = (port: number): Route[] => {
  const lan: Route[] = []
  const tailnet: Route[] = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.internal || a.family !== 'IPv4') continue
      if (TAILSCALE.check(a.address, 'ipv4')) tailnet.push({ kind: 'tailscale', address: `${a.address}:${port}` })
      else if (isAllowedAddress(a.address) && !a.address.startsWith('169.254.')) lan.push({ kind: 'lan', address: `${a.address}:${port}` })
    }
  }
  const name = hostname().split('.')[0]
  const bonjour: Route[] = name && lan.length > 0 ? [{ kind: 'lan', address: `${name}.local:${port}` }] : []
  return [...bonjour, ...lan, ...tailnet]
}

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
