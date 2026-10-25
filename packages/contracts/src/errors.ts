import { z } from 'zod'
import { Scope } from './enums.ts'

/** Errors any procedure may return. Retrying a write is safe because of idempotency keys. */
export const errors = {
  NOT_FOUND: {
    status: 404,
    data: z.object({ entity: z.string(), id: z.string() }),
  },
  FORBIDDEN: {
    status: 403,
    data: z.object({ needs: z.array(Scope), has: Scope.nullable() }),
  },
  CONFLICT: {
    status: 409,
    data: z.object({
      reason: z.enum([
        /** The ask was answered elsewhere (e.g. on the Mac while the phone was offline). */
        'already_answered',
        /** The task was closed meanwhile. */
        'task_closed',
        /** The API versions of client and server are too far apart. */
        'version_mismatch',
      ]),
    }),
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    data: z.object({ what: z.enum(['runner', 'connector', 'claude']), detail: z.string() }),
  },
} as const
