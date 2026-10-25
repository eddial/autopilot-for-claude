/**
 * Every colour, font and radius the apps use, in one place. The Mac window reads them as CSS
 * variables from the generated `apps/desktop/src/tokens.css`; the phone imports them. A colour
 * written anywhere else fails the tokens test.
 */

export const colours = {
  // Surfaces, darkest to lightest.
  well: '#141413',
  window: '#1F1E1D',
  surface: '#262624',
  open: '#2B2A28',
  raised: '#30302E',
  button: '#3D3D3A',
  buttonHover: '#474744',
  grip: '#4D4C48',

  // Text, strongest to quietest.
  text: '#FAF9F5',
  textBody: '#F0EEE6',
  textSoft: '#E8E6DC',
  text2: '#C2C0B6',
  text3: '#9C9A92',
  muted: '#6B6A65',

  // Clay asks for you; pilot green means it is running or well.
  clay: '#D97757',
  claySoft: '#E8A086',
  clayTint: 'rgba(217, 119, 87, 0.12)',
  pilot: '#5DB08F',
  pilotSoft: '#8FCDB2',
  pilotTint: 'rgba(93, 176, 143, 0.14)',

  border: 'rgba(222, 220, 209, 0.15)',
  borderStrong: 'rgba(222, 220, 209, 0.22)',
  hover: 'rgba(255, 255, 255, 0.04)',
  press: 'rgba(255, 255, 255, 0.07)',
  scrim: 'rgba(0, 0, 0, 0.35)',
  shadow: 'rgba(0, 0, 0, 0.45)',
} as const

export type Colour = keyof typeof colours

/** What a dot, a banner or a label says about something. */
export const tones = {
  attention: { fg: colours.claySoft, bg: colours.clayTint, dot: colours.clay },
  good: { fg: colours.pilotSoft, bg: colours.pilotTint, dot: colours.pilot },
  quiet: { fg: colours.text3, bg: colours.hover, dot: colours.muted },
} as const

export type Tone = keyof typeof tones

export const fonts = {
  /** Headings. The window bundles Source Serif; the phone uses the system's Georgia until it does too. */
  serif: "'Anthropic Serif', 'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif",
  serifNative: 'Georgia',
  sans: "'Anthropic Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: 'ui-monospace, Menlo, monospace',
} as const

export const radius = { sm: 8, md: 10, lg: 12, xl: 18, round: 999 } as const

/** Spacing steps; layout primitives take only these. */
export const space = { 0: 0, 1: 4, 2: 6, 3: 8, 4: 10, 5: 12, 6: 14, 7: 16, 8: 20, 9: 24, 10: 32 } as const

export type Space = keyof typeof space

/** The pilot, Autopilot's mascot, in pilot green with a captain's cap, gold wings and aviators. 16×12. */
export const pilot = {
  rows: [
    '...NNNNNNNNNN...',
    '..NNNNGYYGNNNN..',
    '..KKKKKKKKKKKK..',
    '.VVVVVVVVVVVVVV.',
    '..BBBBBBBBBBBB..',
    '..BhAAKKKKhAAB..',
    'BBBAAABBBBAAABBB',
    'BBBBBBBBBBBBBBBB',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '...B.B....B.B...',
    '...B.B....B.B...',
  ],
  colours: {
    B: colours.pilot,
    N: '#26303A',
    G: '#E2B84B',
    Y: '#F4D67E',
    K: '#0E0E0E',
    V: '#1A1A1A',
    A: '#17262E',
    h: '#9CC3D2',
  } as Record<string, string>,
} as const
