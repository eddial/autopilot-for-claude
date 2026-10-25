import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateTask } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { loadCheckouts } from '../src/checkouts.ts'
import { openDatabase } from '../src/db.ts'
import { Launcher, type Pty } from '../src/launcher.ts'
import { resolvePaths } from '../src/paths.ts'
import { Service } from '../src/service.ts'

const checkout = (dir: string, remote: string) => {
  mkdirSync(dir, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('remote', 'add', 'origin', remote)
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start')
}

describe('where a session works', () => {
  it('gives a task that names a repository a worktree of its checkout, and anything else a folder of its own', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ap-checkouts-')))
    const code = join(dir, 'code')
    checkout(join(code, 'product'), 'git@github.com:acme/product.git')
    checkout(join(code, 'clients', 'site'), 'https://github.com/acme/site')
    const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
    mkdirSync(paths.home, { recursive: true })
    writeFileSync(join(paths.home, 'checkouts.yaml'), `roots: [${code}]\ndefault: ${join(code, 'product')}\n`)

    // Found by their remotes, two folders deep.
    const checkouts = loadCheckouts(paths.home)
    expect(checkouts).toEqual({
      repos: { 'acme/product': join(code, 'product'), 'acme/site': join(code, 'clients', 'site') },
      fallback: join(code, 'product'),
    })

    const service = new Service({ db: openDatabase(':memory:') })
    const cwds: string[] = []
    const pty: Pty = { pid: 1, write: () => {}, kill: () => {}, onData: () => {}, onExit: () => {} }
    const launcher = new Launcher({
      service,
      paths,
      workstreams: () => [],
      spawn: (_file, _args, options) => {
        cwds.push(options.cwd)
        return pty
      },
      self: { node: process.execPath, script: 'autopilot.js' },
      checkouts: () => checkouts,
    })
    service.createTask(
      CreateTask.parse({
        idempotencyKey: 'co-000001',
        title: 'Review the PR',
        brief: 'Please review https://github.com/acme/site/pull/12',
      }),
    )
    service.createTask(CreateTask.parse({ idempotencyKey: 'co-000002', title: 'Draft the investor update' }))
    await launcher.drain()

    expect(cwds).toEqual([join(code, 'clients', 'site', '.claude', 'worktrees', 'AP-1'), join(paths.data, 'work', 'inbox', 'AP-2')])
    // The plain folder is a repository of its own, so what the session makes has history.
    expect(existsSync(join(paths.data, 'work', 'inbox', 'AP-2', '.git'))).toBe(true)
  })
})
