import type { contract } from '@autopilot/contracts'
import { createORPCClient } from '@orpc/client'
import { RPCLink as HttpLink } from '@orpc/client/fetch'
import { RPCLink as PortLink } from '@orpc/client/message-port'
import type { ContractRouterClient } from '@orpc/contract'
import type { Shell } from '../electron/preload.ts'

declare global {
  interface Window {
    autopilotShell?: Shell
  }
}

export type Api = ContractRouterClient<typeof contract>

export const shell: Shell | null = window.autopilotShell ?? null

/**
 * In the Mac app the API runs over a MessagePort to the main process, which holds the token.
 * In a plain browser (tests, `pnpm dev:web`) it goes over HTTP to the page's own origin.
 */
const link = (() => {
  if (!shell) return new HttpLink({ url: `${location.origin}/rpc` })
  const { port1, port2 } = new MessageChannel()
  window.postMessage('autopilot:port', '*', [port2])
  port1.start()
  return new PortLink({ port: port1 })
})()

export const api: Api = createORPCClient(link)

export const key = (): string => crypto.randomUUID()
