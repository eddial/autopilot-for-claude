import { Appearance } from 'react-native'
import { reloadAppAsync } from 'expo'
import KV from 'expo-sqlite/kv-store'
import { colours, lightColours, toneColours, tones } from '@autopilot/design'

/** Light or dark as the iPhone is set (the default), or always one of them, chosen in the app's settings. */
export type AppearanceChoice = 'system' | 'light' | 'dark'
const KEY = 'autopilot.appearance'
const read = (): AppearanceChoice => {
  try {
    const set = KV.getItemSync(KEY)
    return set === 'light' || set === 'dark' ? set : 'system'
  } catch {
    return 'system'
  }
}
export const appearanceChoice: AppearanceChoice = read()
// The native bars and menus follow the choice too.
if (appearanceChoice !== 'system') Appearance.setColorScheme(appearanceChoice)

/**
 * The screens build their styles once, from the shared tokens, so the palette is chosen here,
 * before any of them loads (index.ts imports this first), and the app starts again when the
 * setting (the iPhone's, or the app's own) changes.
 */
const scheme = appearanceChoice === 'system' ? Appearance.getColorScheme() : appearanceChoice

if (scheme === 'light') {
  Object.assign(colours as Record<string, string>, lightColours)
  for (const [name, parts] of Object.entries(toneColours)) {
    const tone = tones[name as keyof typeof tones] as Record<'fg' | 'bg' | 'dot', string>
    tone.fg = colours[parts.fg]
    tone.bg = colours[parts.bg]
    tone.dot = colours[parts.dot]
  }
}

export const colourScheme: 'light' | 'dark' = scheme === 'light' ? 'light' : 'dark'

Appearance.addChangeListener(({ colorScheme }) => {
  if (appearanceChoice !== 'system') return
  if ((colorScheme === 'light' ? 'light' : 'dark') !== colourScheme) void reloadAppAsync('The appearance changed')
})

/** Saves the choice and starts the app again in it. */
export const chooseAppearance = (choice: AppearanceChoice): void => {
  if (choice === appearanceChoice) return
  try {
    KV.setItemSync(KEY, choice)
  } catch {
    return
  }
  void reloadAppAsync('The appearance changed')
}
