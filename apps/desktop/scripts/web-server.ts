import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { Client } from '@autopilot/server/client'
import { RPCHandler } from '@orpc/server/node'
import { createServer as createVite } from 'vite'
import { proxyRouter } from '../electron/proxy.ts'

/**
 * The window in a plain browser: Vite serves it, and `/rpc` forwards to the server with the
 * owner's client, as the Mac app's main process does over its MessagePort. Listens on
 * 127.0.0.1 only; for development and tests, never for remote use.
 */
export const serveWeb = async (client: Client, port = 0): Promise<{ url: string; close(): Promise<void> }> => {
  const vite = await createVite({
    configFile: join(import.meta.dirname, '..', 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false },
    logLevel: 'warn',
  })
  const handler = new RPCHandler(proxyRouter(client))
  const server: Server = createServer(async (req, res) => {
    const { matched } = await handler.handle(req, res, { prefix: '/rpc', context: {} })
    if (!matched) vite.middlewares(req, res)
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`
  return {
    url,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await vite.close()
    },
  }
}
