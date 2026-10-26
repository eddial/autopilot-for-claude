import { useState } from 'react'
import KV from 'expo-sqlite/kv-store'

const PREFIX = 'autopilot.draft.'

/**
 * Text being written, kept as it is typed, so the app being closed or killed does not lose it, as
 * on the Mac. Keyed by where it is written (`AP-2:composer`); setting it to '' clears it.
 */
export const useDraft = (key: string): [string, (text: string) => void] => {
  const [text, setText] = useState(() => {
    try {
      return KV.getItemSync(PREFIX + key) ?? ''
    } catch {
      return ''
    }
  })
  const set = (next: string) => {
    setText(next)
    try {
      if (next) KV.setItemSync(PREFIX + key, next)
      else KV.removeItemSync(PREFIX + key)
    } catch {
      // Storage unavailable: the draft lives only as long as the screen.
    }
  }
  return [text, set]
}
