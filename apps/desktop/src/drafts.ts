import { useState } from 'react'

const PREFIX = 'autopilot.draft.'

const read = (key: string): string => {
  try {
    return localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

const write = (key: string, text: string) => {
  try {
    if (text) localStorage.setItem(PREFIX + key, text)
    else localStorage.removeItem(PREFIX + key)
  } catch {
    // Private or full storage: the draft lives only as long as the window.
  }
}

/**
 * Text being written, kept as it is typed, so a restart, a crash or a closed window does not lose
 * it. Keyed by where it is written (`AP-2:answers`); setting it to '' after sending clears it.
 */
export const useDraft = (key: string): [string, (text: string) => void] => {
  const [text, setText] = useState(() => read(key))
  const set = (next: string) => {
    setText(next)
    write(key, next)
  }
  return [text, set]
}
