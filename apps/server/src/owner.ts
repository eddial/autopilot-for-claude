import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths } from './paths.ts'
import type { Service } from './service.ts'

/**
 * The owner's token for the CLI on this Mac. Created on first start and kept in a file only this
 * user can read. Moves to the Keychain with the Mac app (phase 2). Sessions run as the same user,
 * so this is a guardrail, not isolation (docs/decisions/0006-write-back-through-mcp.md).
 */
const file = (paths: Paths) => join(paths.data, 'owner.token')

export const ensureDataDir = (paths: Paths): void => {
  mkdirSync(paths.data, { recursive: true, mode: 0o700 })
  mkdirSync(paths.logs, { recursive: true, mode: 0o700 })
}

export const ensureOwnerToken = (paths: Paths, service: Service): string => {
  const existing = readOwnerToken(paths)
  if (existing && service.authenticate(existing)?.scope === 'owner') return existing
  const { secret } = service.issueToken('This Mac', 'owner', null)
  ensureDataDir(paths)
  writeFileSync(file(paths), `${secret}\n`, { mode: 0o600 })
  chmodSync(file(paths), 0o600)
  return secret
}

export const readOwnerToken = (paths: Paths): string | null =>
  existsSync(file(paths)) ? readFileSync(file(paths), 'utf8').trim() || null : null
