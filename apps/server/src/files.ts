import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Link, UploadFile } from '@autopilot/contracts'
import type { z } from 'zod'

const MAX_BYTES = 20 * 1024 * 1024

/** "2.4 MB", "830 KB": a file's size as its chip says it. */
export const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * Keeps a file the owner sent with the task, in `<root>/<task>/`, and returns its link. The name
 * starts with the call's key, so a retry writes the same file and two pastes of `image.png` differ.
 */
export const storeFile = (root: string, input: z.infer<typeof UploadFile>): Link => {
  const bytes = Buffer.from(input.data, 'base64')
  if (bytes.length > MAX_BYTES) throw new RangeError(`${input.name} is over 20 MB`)
  const name =
    basename(input.name)
      .replace(/[^\w.\- ]+/g, '_')
      .slice(-120) || 'file'
  const key = input.idempotencyKey.replace(/[^\w-]/g, '').slice(0, 8)
  const dir = join(root, input.taskId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${key}-${name}`)
  writeFileSync(path, bytes)
  return { url: pathToFileURL(path).href, title: input.name.slice(0, 200), subtitle: sizeText(bytes.length) }
}
