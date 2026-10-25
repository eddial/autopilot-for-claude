import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** A folder git knows as a checkout: what a workstream's `repo` must be for worktrees. */
export const isGitCheckout = (path: string): boolean => {
  if (!existsSync(path)) return false
  try {
    execFileSync('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
