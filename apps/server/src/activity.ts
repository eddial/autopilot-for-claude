/**
 * What a session is doing, in a few plain words, from the tool it is about to use: the line a
 * running task shows ("Reading launcher.ts", "Searching the web for SCIM pricing").
 */

const MAX = 80

const file = (path: unknown) => (typeof path === 'string' ? (path.split('/').pop() ?? path) : 'a file')

const quoted = (text: unknown) => {
  const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : ''
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

/** `mcp__claude_ai_Slack__slack_read_thread` → `Slack`. */
const connector = (tool: string) =>
  (tool.split('__')[1] ?? tool)
    .replace(/^claude_ai_/, '')
    .replace(/_/g, ' ')
    .replace(/^plugin /, '')

const AUTOPILOT: Record<string, string> = {
  get_task: 'Reading the task',
  post_update: 'Writing the handover',
  attach_link: 'Linking what it made',
  add_watcher: 'Setting up a watcher',
  wait_on: 'Handing over to wait',
}

export const activityOf = (tool: string, input: Record<string, unknown>): string => {
  const line = (() => {
    switch (tool) {
      case 'Read':
        return `Reading ${file(input.file_path)}`
      case 'Edit':
      case 'MultiEdit':
        return `Editing ${file(input.file_path)}`
      case 'Write':
        return `Writing ${file(input.file_path)}`
      case 'Grep':
      case 'Glob':
        return 'Searching the code'
      case 'Bash':
        return typeof input.description === 'string' && input.description.trim()
          ? input.description.trim()
          : `Running ${quoted(String(input.command ?? '').split(/\s+/)[0])}`
      case 'WebSearch':
        return `Searching the web for “${quoted(input.query)}”`
      case 'WebFetch': {
        const host = /^https?:\/\/([^/]+)/.exec(String(input.url ?? ''))?.[1]
        return host ? `Reading ${host.replace(/^www\./, '')}` : 'Reading a web page'
      }
      case 'Task':
      case 'Agent':
        return 'Working with a helper'
      case 'TodoWrite':
        return 'Planning the next steps'
    }
    if (tool.startsWith('mcp__autopilot__')) return AUTOPILOT[tool.slice('mcp__autopilot__'.length)] ?? 'Talking to Autopilot'
    if (tool.startsWith('mcp__')) return `Using ${connector(tool)}`
    return `Using ${tool}`
  })()
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line
}
