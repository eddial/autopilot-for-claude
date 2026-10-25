import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Task } from '@autopilot/contracts'
import { parse as parseYaml } from 'yaml'

/**
 * Where code work happens. A task that names a GitHub repository (a pull request, an issue, a
 * link in its brief) gets a worktree of that repository's checkout on this Mac, found by its
 * remote; `home/checkouts.yaml` says where to look and which checkout `repo: default` means.
 */

export type Checkouts = {
  /** `owner/name`, lowercase, to the checkout's folder. */
  repos: Record<string, string>
  /** The checkout a workstream's `repo: default` means. */
  fallback: string | null
}

/** Where people keep their code, when checkouts.yaml does not say. */
const ROOTS = ['~/Sites', '~/code', '~/dev', '~/src', '~/Projects', '~/Developer', '~/repos', '~/git']

const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

/** `github.com/owner/name`, wherever it sits in text: before a comma, a full stop, a bracket. */
const GITHUB = /github\.com[/:]([\w.-]+)\/([\w-]+(?:\.(?!git\b)[\w-]+)*)/gi

/** Every `owner/name` a text names on GitHub, in order. */
export const githubRepos = (text: string): string[] => [...text.matchAll(GITHUB)].map((m) => `${m[1]}/${m[2]}`.toLowerCase())

const remoteOf = (dir: string): string | null => {
  try {
    const url = execFileSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return githubRepos(url)[0] ?? null
  } catch {
    return null
  }
}

/** Checkouts up to two folders deep under each root, by their GitHub remote. Worktrees are skipped. */
export const findCheckouts = (roots: string[]): Record<string, string> => {
  const repos: Record<string, string> = {}
  const visit = (dir: string, depth: number) => {
    if (existsSync(join(dir, '.git'))) {
      const repo = remoteOf(dir)
      // The first found wins: a root listed earlier is the one the person works in.
      if (repo && !(repo in repos) && !dir.includes('/.claude/worktrees/')) repos[repo] = dir
      return
    }
    if (depth === 0) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => e.name)
    } catch {
      return
    }
    for (const name of entries) visit(join(dir, name), depth - 1)
  }
  for (const root of roots) if (existsSync(root)) visit(root, 2)
  return repos
}

/** Reads `home/checkouts.yaml` (all optional) and finds the checkouts it points to. */
export const loadCheckouts = (home: string): Checkouts => {
  const file = join(home, 'checkouts.yaml')
  const settings = existsSync(file) ? ((parseYaml(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>) : {}
  const roots = Array.isArray(settings.roots) ? settings.roots.map((r) => expand(String(r))) : ROOTS.map(expand)
  const fallback = typeof settings.default === 'string' && settings.default.trim() ? expand(settings.default.trim()) : null
  return { repos: findCheckouts(roots), fallback }
}

/** The checkout for a task that names a GitHub repository, in its source, its links or its brief. */
export const checkoutFor = (task: Task, checkouts: Checkouts): string | null => {
  const texts = [task.source.url ?? '', ...task.links.map((l) => l.url), task.brief]
  for (const repo of texts.flatMap(githubRepos)) {
    const dir = checkouts.repos[repo]
    if (dir) return dir
  }
  return null
}
