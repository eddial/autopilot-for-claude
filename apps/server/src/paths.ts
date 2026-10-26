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
  /** The session host's socket: the terminals sessions run in, which outlive the server. */
  sessionHost: string
  logs: string
  /**
   * Where tasks with no repository work, unless checkouts.yaml says otherwise: ~/Autopilot for the
   * Mac's own data, a folder inside it for any other (tests), so a test never writes to ~/Autopilot.
   */
  workspace: string
}

export const resolvePaths = (env: NodeJS.ProcessEnv = process.env): Paths => {
  const usual =
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Autopilot')
      : join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'autopilot')
  const data = env.AUTOPILOT_DATA ?? usual
  return {
    workspace: data === usual ? join(homedir(), 'Autopilot') : join(data, 'workspace'),
    data,
    home: env.AUTOPILOT_HOME ?? join(data, 'home'),
    db: join(data, 'autopilot.sqlite'),
    // macOS limits socket paths to 104 bytes; the default stays well under it.
    socket: env.AUTOPILOT_SOCKET ?? join(data, 'autopilot.sock'),
    sessionHost: join(data, 'sessions.sock'),
    logs: join(data, 'logs'),
  }
}
