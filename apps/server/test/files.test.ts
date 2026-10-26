import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sweepFiles } from '../src/files.ts'

describe('files sent with tasks', () => {
  it('removes only the folders of tasks that no longer keep them', () => {
    const root = mkdtempSync(join(tmpdir(), 'ap-files-'))
    for (const task of ['AP-1', 'AP-2']) {
      mkdirSync(join(root, task))
      writeFileSync(join(root, task, 'notes.txt'), 'x')
    }
    expect(sweepFiles(root, (task) => task === 'AP-1')).toEqual(['AP-2'])
    expect([existsSync(join(root, 'AP-1', 'notes.txt')), existsSync(join(root, 'AP-2'))]).toEqual([true, false])
  })
})
