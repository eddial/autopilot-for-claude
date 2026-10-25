import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** Where the server keeps its data, config and socket. Every path can be overridden for tests. */
export type Paths = {
  /** Database, socket, logs. */
  data: string
  /** A person's config: workstreams/ and signals/ as Markdown, the same format as the Linear version. */
  home: string
  db: string
  socket: string
  logs: string
}

export const resolvePaths = (env: NodeJS.ProcessEnv = process.env): Paths => {
  const data =
    env.AUTOPILOT_DATA ??
    (platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Autopilot')
      : join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'autopilot'))
  return {
    data,
    home: env.AUTOPILOT_HOME ?? join(data, 'home'),
    db: join(data, 'autopilot.sqlite'),
    // macOS limits socket paths to 104 bytes; the default stays well under it.
    socket: env.AUTOPILOT_SOCKET ?? join(data, 'autopilot.sock'),
    logs: join(data, 'logs'),
  }
}
