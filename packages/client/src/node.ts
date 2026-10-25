import { connect, type TLSSocket } from 'node:tls'
import { isIP } from 'node:net'
import { Agent, fetch } from 'undici'
import type { PinnedFetch } from './connection.ts'

/** Pinned HTTPS for Node (tests, and the Mac app as a client of another Mac in phase 4). */
export const nodePinnedFetch = (): PinnedFetch => {
  const agents = new Map<string, Agent>()
  const agentFor = (fingerprint: string): Agent => {
    let agent = agents.get(fingerprint)
    if (!agent) {
      agent = new Agent({
        connect: (options, callback) => {
          const socket: TLSSocket = connect({
            host: options.hostname,
            port: Number(options.port) || 443,
            ...(isIP(options.hostname) ? {} : { servername: options.hostname }),
            // Trust comes from the fingerprint below, not from a certificate authority.
            rejectUnauthorized: false,
          })
          socket.once('secureConnect', () => {
            if (socket.getPeerX509Certificate()?.fingerprint256 === fingerprint) callback(null, socket)
            else {
              socket.destroy()
              callback(new Error('The server certificate does not match the paired one'), null)
            }
          })
          socket.once('error', (error) => callback(error, null))
        },
      })
      agents.set(fingerprint, agent)
    }
    return agent
  }
  return async (url, init, fingerprint) => {
    const response = await fetch(url, { ...init, dispatcher: agentFor(fingerprint) })
    return new Response(response.body as ReadableStream<Uint8Array> | null, {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
    })
  }
}
