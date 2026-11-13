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

/** The folders of a checkout's worktrees (the checkout itself first), each with the branch it has out. */
export const worktreesOf = (path: string): { dir: string; branch: string | null }[] => {
  try {
    const out = execFileSync('git', ['-C', path, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split('\n\n')
      .map((block) => ({
        dir: /^worktree (.+)$/m.exec(block)?.[1] ?? '',
        branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null,
      }))
      .filter((w) => w.dir && existsSync(w.dir))
  } catch {
    return []
  }
}

/** The branch a pull request comes from, asked of GitHub; null when `gh` cannot say. */
export const pullRequestBranch = (url: string): string | null => {
  try {
    const out = execFileSync('gh', ['pr', 'view', url, '--json', 'headRefName', '-q', '.headRefName'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Where Auto-fix for a pull request in `repo` can start. `/autofix-pr` finds its pull request by
 * the branch the folder it is typed in has out (`gh pr view` with no number) and refuses on the
 * default branch, so it is a worktree with the pull request's `branch` out, in a checkout with the
 * repository's GitHub remote: where the session that opened it worked. `clones` are the checkouts
 * of `repo` on this Mac; each one's worktrees are looked through, wherever they are.
 */
export const autofixCheckout = (repo: string, branch: string, clones: string[]): string | null => {
  for (const clone of clones) {
    if (!hasGitHubRemote(clone, repo)) continue
    const on = worktreesOf(clone).find((w) => w.branch === branch)
    if (on) return on.dir
  }
  return null
}
