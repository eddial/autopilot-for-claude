import { requireNativeModule } from 'expo'

type NativeResponse = { status: number; headers: Record<string, string>; body: string }

type PinnedFetchNative = {
  request(
    id: string,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    fingerprint: string,
  ): Promise<NativeResponse>
  cancel(id: string): void
}

/** The Swift module in ios/PinnedFetchModule.swift. */
export default requireNativeModule<PinnedFetchNative>('PinnedFetch')
