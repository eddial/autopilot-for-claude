import { z } from 'zod'

/** `AP-212`, or a mirrored team ticket such as `LLE-15982`. */
export const TaskId = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*-\d+$/)
  .describe('Task identifier, e.g. AP-212')

export const Id = z.string().min(1).max(64)

export const Timestamp = z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp')

/** `30m`, `1h`, `14d`. */
export const Duration = z
  .string()
  .regex(/^\d+[mhd]$/)
  .describe('Duration such as 30m, 1h or 14d')

/** Chosen by the caller, unique per write; a repeated key is ignored by the server. */
export const IdempotencyKey = z.string().min(8).max(128).describe('Unique per write; the server ignores a key it has already applied')

/** 1 urgent, 2 high, 3 normal, 4 low. */
export const Priority = z.int().min(1).max(4)

export const Link = z.object({
  url: z.url(),
  /** Short: it shows on one line, cut off when longer ("Draft reply to Sofie", not a sentence). */
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  /** When it was linked; the server sets it. Missing on links from before. */
  at: z.iso.datetime({ offset: true }).optional(),
})
export type Link = z.infer<typeof Link>
