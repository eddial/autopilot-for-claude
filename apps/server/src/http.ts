import { chmodSync, existsSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { RPCHandler } from '@orpc/server/node'
import type { Router } from './api.ts'
import type { Service } from './service.ts'

/**
 * Serves the API over a Unix socket that only this user can open. Every call
 * still carries a token (`Authorization: Bearer …`), so a process running as
 * the same user cannot act as the owner without the owner's token.
 */
export const listen = async (router: Router, service: Service, socket: string): Promise<Server> => {
  const handler = new RPCHandler(router)
  const server = createServer(async (req, res) => {
    const header = req.headers.authorization
    const principal = header?.startsWith('Bearer ') ? service.authenticate(header.slice(7)) : null
    const { matched } = await handler.handle(req, res, { prefix: '/rpc', context: { principal } })
    if (!matched) {
      res.statusCode = 404
      res.end('Not found')
    }
  })
  if (existsSync(socket)) rmSync(socket)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket, () => resolve())
  })
  chmodSync(socket, 0o600)
  return server
}
