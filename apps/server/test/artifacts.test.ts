import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AttachLink, CreateTask } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { previewArtifact } from '../src/artifacts.ts'
import { openDatabase } from '../src/db.ts'
import { DomainError, Service } from '../src/service.ts'

describe('artifact previews', () => {
  it('reads the start of a text file the task links to, and nothing it does not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-artifact-'))
    const draft = pathToFileURL(join(dir, 'reply.md')).href
    const secret = pathToFileURL(join(dir, 'notes.md')).href
    writeFileSync(join(dir, 'reply.md'), '# Reply to Northwind\n\nThanks for asking about SSO.')
    writeFileSync(join(dir, 'notes.md'), 'not attached')
    const service = new Service({ db: openDatabase(':memory:') })
    const task = service.createTask(CreateTask.parse({ idempotencyKey: 'art-00001', title: 'Answer Northwind', start: false }))
    service.attachLink(
      AttachLink.parse({ idempotencyKey: 'art-00002', taskId: task.id, link: { url: draft, title: 'Reply draft' } }),
      'session',
    )

    const linked = service.task(task.id)
    expect(previewArtifact(linked, draft)).toMatchObject({ text: '# Reply to Northwind\n\nThanks for asking about SSO.', truncated: false })
    expect(() => previewArtifact(linked, secret)).toThrow(DomainError)
  })
})
