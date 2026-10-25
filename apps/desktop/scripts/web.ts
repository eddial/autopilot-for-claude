import { connect } from '@autopilot/server/client'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths } from '@autopilot/server/paths'
import { serveWeb } from './web-server.ts'

// `pnpm --filter @autopilot/desktop web`: the window in a browser, against the running server.
const paths = resolvePaths()
const token = readOwnerToken(paths)
if (!token) throw new Error('No owner token: start the server once with `autopilot serve`.')
const { url } = await serveWeb(connect(paths.socket, token), Number(process.env.PORT ?? 5174))
console.log(`Autopilot in the browser: ${url}`)
