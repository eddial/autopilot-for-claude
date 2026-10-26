import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateTask } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { loadCheckouts, saveWorkspace } from '../src/checkouts.ts'
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
  it('gives a task that names a repository a worktree of its checkout, and anything else a worktree of the workspace', async () => {
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
      workspace: () => join(dir, 'Autopilot'),
    })
    service.createTask(
      CreateTask.parse({
        idempotencyKey: 'co-000001',
        title: 'Review the PR',
        // Named in passing, before a comma, as people write it.
        brief: 'In https://github.com/acme/site, please review the open PR.',
      }),
    )
    service.createTask(CreateTask.parse({ idempotencyKey: 'co-000002', title: 'Draft the investor update' }))
    await launcher.drain()

    // One workspace for everything without a repository, so the Claude app lists them under one name.
    expect(cwds).toEqual([
      join(code, 'clients', 'site', '.claude', 'worktrees', 'AP-1'),
      join(dir, 'Autopilot', '.claude', 'worktrees', 'AP-2'),
    ])
    expect(existsSync(join(dir, 'Autopilot', '.claude', 'worktrees', 'AP-2', '.git'))).toBe(true)
  })

  it('takes a new or empty folder, or a repository, as the workspace, never a folder of files', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ap-workspace-')))
    const home = join(dir, 'home')
    mkdirSync(home)
    writeFileSync(join(home, 'checkouts.yaml'), '# where code lives\nroots: [~/Sites]\n')
    mkdirSync(join(dir, 'Documents'))
    writeFileSync(join(dir, 'Documents', 'taxes.pdf'), '')

    expect(() => saveWorkspace(home, join(dir, 'Documents'))).toThrow(/already holds files/)
    saveWorkspace(home, join(dir, 'Autopilot'))
    expect(existsSync(join(dir, 'Autopilot', '.git'))).toBe(true)
    // The rest of the file, comments included, stays.
    expect(readFileSync(join(home, 'checkouts.yaml'), 'utf8')).toBe(
      `# where code lives\nroots: [ ~/Sites ]\nworkspace: ${join(dir, 'Autopilot')}\n`,
    )
  })
})
