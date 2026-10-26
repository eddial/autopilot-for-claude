import { Appearance } from 'react-native'
import { reloadAppAsync } from 'expo'
import { colours, lightColours, toneColours, tones } from '@autopilot/design'

/**
 * Light or dark as the iPhone is set. The screens build their styles once, from the shared tokens,
 * so the palette is chosen here, before any of them loads (index.ts imports this first), and the
 * app starts again when the setting changes.
 */
const scheme = Appearance.getColorScheme()

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
  if ((colorScheme === 'light' ? 'light' : 'dark') !== colourScheme) void reloadAppAsync('The appearance changed')
})
