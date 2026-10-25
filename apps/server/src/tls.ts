import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { join } from 'node:path'
import type { Paths } from './paths.ts'

export type Certificate = { key: string; cert: string; fingerprint: string }

/**
 * The server's own TLS certificate for devices, made once with the system's `openssl`. It is
 * self-signed: devices pin its SHA-256 fingerprint from the pairing invite instead of trusting a
 * certificate authority, which also works for bare IP addresses and changing networks.
 */
export const ensureCertificate = (paths: Paths): Certificate => {
  const keyFile = join(paths.data, 'device-tls.key')
  const certFile = join(paths.data, 'device-tls.crt')
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '3650',
        '-subj',
        '/CN=Autopilot',
        '-keyout',
        keyFile,
        '-out',
        certFile,
      ],
      { stdio: 'ignore' },
    )
    chmodSync(keyFile, 0o600)
  }
  const cert = readFileSync(certFile, 'utf8')
  return { key: readFileSync(keyFile, 'utf8'), cert, fingerprint: new X509Certificate(cert).fingerprint256 }
}
