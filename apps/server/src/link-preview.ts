import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LinkPreview, Task } from '@autopilot/contracts'
import { DomainError } from './service.ts'

/** Files worth reading in place: what sessions write as drafts, notes and data. */
const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.yaml', '.yml', '.html', '.eml', '.ts', '.tsx', '.js', '.py', '.sql'])

/** Enough to read a draft or a note; a longer file opens in its own app. */
const LIMIT = 64 * 1024

const NONE = (bytes = 0): LinkPreview => ({ text: null, bytes, truncated: false })

/**
 * The start of a local text file the task links to. Only the task's own links are read, so a
 * reader cannot ask for any file on the Mac by naming it.
 */
export const previewLink = (task: Task, url: string): LinkPreview => {
  if (!task.links.some((l) => l.url === url)) throw new DomainError('NOT_FOUND', { entity: 'link', id: url })
  if (!url.startsWith('file:')) return NONE()
  const path = fileURLToPath(url)
  let size: number
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return NONE()
    size = stat.size
  } catch {
    return NONE()
  }
  if (!TEXT.has(extname(path).toLowerCase())) return NONE(size)
  const buffer = Buffer.alloc(Math.min(size, LIMIT))
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, 0)
  } finally {
    closeSync(fd)
  }
  return { text: buffer.toString('utf8'), bytes: size, truncated: size > LIMIT }
}
