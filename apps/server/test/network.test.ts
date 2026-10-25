import { describe, expect, it } from 'vitest'
import { isAllowedAddress } from '../src/network.ts'

describe('the device listener', () => {
  it('lets in this Mac, private networks and the tailnet, and nothing from the internet', () => {
    const allowed = ['127.0.0.1', '::1', '192.168.1.20', '::ffff:10.0.0.7', '172.20.1.1', '100.101.102.103', 'fd7a:115c:a1e0::1', 'fe80::1']
    const refused = ['8.8.8.8', '::ffff:8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888', undefined]
    expect(allowed.filter((a) => !isAllowedAddress(a))).toEqual([])
    expect(refused.filter((a) => isAllowedAddress(a))).toEqual([])
  })
})
