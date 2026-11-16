import type { PullRequestStatus } from './git.ts'
import type { Service } from './service.ts'

export type PullRequestsOptions = {
  service: Service
  /** Where a pull request stands, from GitHub; null when it cannot say. */
  status: (url: string) => Promise<PullRequestStatus | null>
  log?: (message: string) => void
}

/** How often every linked pull request is looked up again. A new link is looked up on the next tick. */
const EVERY_MS = 5 * 60_000

/**
 * Keeps the status on the tasks' pull request links current (open, draft, merged, closed), so both
 * apps show it beside the link. One `gh pr view` per pull request, one at a time.
 */
export class PullRequests {
  private readonly o: PullRequestsOptions
  private running = false
  private lastFull = 0

  constructor(options: PullRequestsOptions) {
    this.o = options
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const now = this.o.service.now().getTime()
      const full = now - this.lastFull >= EVERY_MS
      if (full) this.lastFull = now
      await this.refresh(full)
    } catch (error: unknown) {
      this.o.log?.(`pull requests: ${String(error)}`)
    } finally {
      this.running = false
    }
  }

  /** Looks up the pull requests not yet looked up, or all of them with `all`. */
  async refresh(all = true): Promise<void> {
    const { service } = this.o
    const statuses = new Map<string, PullRequestStatus | null>()
    for (const link of service.pullRequestLinks()) {
      if (!all && link.status) continue
      if (!statuses.has(link.url)) statuses.set(link.url, await this.o.status(link.url))
      const status = statuses.get(link.url)
      if (status) service.setLinkStatus(link.taskId, link.url, status)
    }
  }
}
