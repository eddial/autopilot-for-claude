import { contract } from '@autopilot/contracts'
import type { Client } from '@autopilot/server/client'
import { isContractProcedure } from '@orpc/contract'
import { implement, type Router } from '@orpc/server'

type Node = Record<string, unknown>
type Call = (input: unknown, options: { signal?: AbortSignal | undefined }) => Promise<unknown>
type Leaf = { handler: (fn: (options: { input: unknown; signal?: AbortSignal | undefined }) => Promise<unknown>) => unknown }

/**
 * The whole contract, each procedure forwarding to the server through `client`. The Mac app's
 * main process serves it to the window, so the window speaks the same typed API without holding
 * the owner token; tests serve it over HTTP to a browser.
 */
export const proxyRouter = (client: Client): Router<typeof contract, Record<never, never>> => {
  const walk = (spec: Node, impl: Node, target: Node): Node => {
    const out: Node = {}
    for (const [key, value] of Object.entries(spec)) {
      if (isContractProcedure(value)) {
        const call = target[key] as Call
        out[key] = (impl[key] as Leaf).handler(({ input, signal }) => call(input, { signal }))
      } else {
        out[key] = walk(value as Node, impl[key] as Node, target[key] as Node)
      }
    }
    return out
  }
  // Built by walking the contract, so it has every procedure; TypeScript cannot follow the walk.
  return walk(contract, implement(contract) as unknown as Node, client as unknown as Node) as unknown as Router<
    typeof contract,
    Record<never, never>
  >
}
