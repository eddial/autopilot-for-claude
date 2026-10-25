import { randomUUID } from 'node:crypto'
import { mcpTools, Scope, toolsFor } from '@autopilot/contracts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ORPCError } from '@orpc/client'
import type { Client } from './client.ts'

/** Tokens carry their scope in a readable prefix (`ap_session_…`), so the bridge can list only the tools that will work. */
export const scopeOfToken = (token: string): Scope | null => {
  const parsed = Scope.safeParse(/^ap_([a-z]+)_/.exec(token)?.[1])
  return parsed.success ? parsed.data : null
}

type Call = (input: Record<string, unknown>) => Promise<unknown>

/**
 * `autopilot mcp`: an MCP server on stdio that forwards each tool call to the Autopilot server.
 * Each tool call gets its own idempotency key; the agent never has to make one up.
 */
export const runMcpBridge = async (client: Client, token: string): Promise<void> => {
  const server = new McpServer({ name: 'autopilot', version: '0.1.0' })
  const scope = scopeOfToken(token)
  const tools = scope ? toolsFor(scope) : mcpTools
  const groups = client as unknown as Record<string, Record<string, Call>>

  for (const tool of tools) {
    const [group, name] = tool.procedure
    const call = groups[group]?.[name]
    if (!call) continue
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (args: unknown) => {
      const input = { ...(args as Record<string, unknown>), idempotencyKey: randomUUID() }
      try {
        const result = await call(input)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        const message = error instanceof ORPCError ? `${error.code}: ${error.message} ${JSON.stringify(error.data ?? {})}` : String(error)
        return { isError: true, content: [{ type: 'text' as const, text: message }] }
      }
    })
  }

  await server.connect(new StdioServerTransport())
}
