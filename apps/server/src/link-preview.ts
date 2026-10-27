import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LinkPreview } from '@autopilot/contracts'
import { DomainError } from './service.ts'

/** Files worth reading in place: what sessions write as drafts, notes and data. */
const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.yaml', '.yml', '.html', '.eml', '.ts', '.tsx', '.js', '.py', '.sql'])

/** Enough to read a draft or a note; a longer file opens in its own app. */
const LIMIT = 64 * 1024

/** Pictures shown in place, by their type; a larger one opens in its own app. */
const IMAGES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
const IMAGE_LIMIT = 8 * 1024 * 1024

const NONE = (bytes = 0): LinkPreview => ({ text: null, bytes, truncated: false })

/**
 * The start of a local text file the task links to or an update attaches, or the whole of a
 * picture. Only those are read (`linked`), so a reader cannot ask for any file on the Mac by naming it.
 */
export const previewLink = (linked: Set<string>, url: string): LinkPreview => {
  if (!linked.has(url)) throw new DomainError('NOT_FOUND', { entity: 'link', id: url })
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
  const type = IMAGES[extname(path).toLowerCase()]
  if (type)
    return size > IMAGE_LIMIT ? NONE(size) : { ...NONE(size), image: `data:${type};base64,${readFileSync(path).toString('base64')}` }
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
