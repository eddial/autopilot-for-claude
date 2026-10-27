import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AttachLink, CreateTask, PostUpdate } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { previewLink } from '../src/link-preview.ts'
import { openDatabase } from '../src/db.ts'
import { DomainError, Service } from '../src/service.ts'

describe('link previews', () => {
  it('reads the start of a text file the task links to, a picture an update attaches, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-link-'))
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

    // A screenshot an update attaches is shown whole, as a picture.
    const shot = pathToFileURL(join(dir, 'shot.png')).href
    writeFileSync(join(dir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    service.postUpdate(
      PostUpdate.parse({
        idempotencyKey: 'art-00003',
        taskId: task.id,
        kind: 'review',
        body: 'Screens',
        attachments: [{ url: shot, title: 'Shot' }],
      }),
      'session',
    )

    const linked = service.linkedUrls(task.id)
    expect(previewLink(linked, draft)).toMatchObject({ text: '# Reply to Northwind\n\nThanks for asking about SSO.', truncated: false })
    expect(previewLink(linked, shot).image).toBe('data:image/png;base64,iVBORw==')
    expect(() => previewLink(linked, secret)).toThrow(DomainError)
  })
})
