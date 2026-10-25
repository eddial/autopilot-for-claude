import type { contract } from '@autopilot/contracts'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { Agent, fetch as undiciFetch } from 'undici'

export type Client = ContractRouterClient<typeof contract>

/** A typed client for the server on its Unix socket, used by the CLI and the MCP bridge. */
export const connect = (socket: string, token: string): Client => {
  const dispatcher = new Agent({ connect: { socketPath: socket } })
  const link = new RPCLink({
    url: 'http://autopilot/rpc',
    headers: { authorization: `Bearer ${token}` },
    fetch: async (request) => {
      const body = request.body ? await request.arrayBuffer() : undefined
      const response = await undiciFetch(request.url, {
        method: request.method,
        headers: [...request.headers.entries()],
        body,
        dispatcher,
        signal: request.signal,
      })
      return new Response(response.body as ReadableStream<Uint8Array> | null, {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      })
    },
  })
  return createORPCClient(link)
}
