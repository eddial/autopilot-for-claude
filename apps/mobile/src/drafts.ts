import { useEffect, useRef, useState } from 'react'
import KV from 'expo-sqlite/kv-store'

const PREFIX = 'autopilot.draft.'

const save = (key: string, text: string) => {
  try {
    if (text) KV.setItemSync(PREFIX + key, text)
    else KV.removeItemSync(PREFIX + key)
  } catch {
    // Storage unavailable: the draft lives only as long as the screen.
  }
}

/**
 * Text being written, kept as it is typed, so the app being closed or killed does not lose it, as
 * on the Mac. Keyed by where it is written (`AP-2:composer`); setting it to '' clears it. Written a
 * moment after typing pauses, not on every key, and at once when cleared or when the screen goes.
 */
export const useDraft = (key: string): [string, (text: string) => void] => {
  const [text, setText] = useState(() => {
    try {
      return KV.getItemSync(PREFIX + key) ?? ''
    } catch {
      return ''
    }
  })
  const pending = useRef<{ text: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const flush = () => {
    if (!pending.current) return
    clearTimeout(pending.current.timer)
    save(key, pending.current.text)
    pending.current = null
  }
  // Written before the key changes or the screen goes.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => flush, [key])
  const set = (next: string) => {
    setText(next)
    if (pending.current) clearTimeout(pending.current.timer)
    if (!next) {
      pending.current = null
      save(key, '')
      return
    }
    pending.current = { text: next, timer: setTimeout(flush, 250) }
  }
  return [text, set]
}
