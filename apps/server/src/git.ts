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

/**
 * Whether a checkout has a remote on GitHub for `owner/repo`: Claude Code's Auto-fix starts its
 * cloud session from the checkout it is typed in, so a pull request in another repository fails.
 */
export const hasGitHubRemote = (path: string, repo: string): boolean => {
  try {
    const remotes = execFileSync('git', ['-C', path, 'remote', '-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return remotes
      .split('\n')
      .some((line) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s/i.exec(line)?.[1]?.toLowerCase() === repo.toLowerCase())
  } catch {
    return false
  }
}
