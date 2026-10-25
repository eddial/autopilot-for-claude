import type { PinnedFetch } from '@autopilot/client'
import PinnedFetchNative from '../modules/pinned-fetch/src/index.ts'

let next = 0

/** HTTPS through the Swift module, which trusts only the paired Mac's certificate. */
export const pinnedFetch: PinnedFetch = async (url, init, fingerprint) => {
  const id = String(++next)
  const cancel = () => PinnedFetchNative.cancel(id)
  init.signal?.addEventListener('abort', cancel)
  try {
    if (init.signal?.aborted) throw new Error('Aborted')
    const response = await PinnedFetchNative.request(id, url, init.method, init.headers, init.body ?? null, fingerprint)
    return new Response(response.body, { status: response.status, headers: response.headers })
  } finally {
    init.signal?.removeEventListener('abort', cancel)
  }
}
