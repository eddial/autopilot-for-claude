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

  // Pilot green is Autopilot's own colour: what needs you, the primary action, what is well or new
  // from a signal. Clay is Claude's: the session at work. Amber is paused on something: waiting on
  // others, snoozed, a watcher.
  clay: '#D97757',
  claySoft: '#E8A086',
  clayTint: 'rgba(217, 119, 87, 0.12)',
  pilot: '#5DB08F',
  pilotSoft: '#8FCDB2',
  pilotTint: 'rgba(93, 176, 143, 0.14)',
  amber: '#D9A94E',
  amberSoft: '#E8C47F',
  amberTint: 'rgba(217, 169, 78, 0.14)',

  border: 'rgba(222, 220, 209, 0.15)',
  borderStrong: 'rgba(222, 220, 209, 0.22)',
  hover: 'rgba(255, 255, 255, 0.04)',
  press: 'rgba(255, 255, 255, 0.07)',
  scrim: 'rgba(0, 0, 0, 0.35)',
  shadow: 'rgba(0, 0, 0, 0.45)',
} as const

export type Colour = keyof typeof colours

/** What a dot, a banner, a pill or a button says about something. */
export const tones = {
  /** Autopilot: needs you, the next step, healthy, new. */
  pilot: { fg: colours.pilotSoft, bg: colours.pilotTint, dot: colours.pilot },
  /** Claude at work: a running session. */
  claude: { fg: colours.claySoft, bg: colours.clayTint, dot: colours.clay },
  /** Waiting on something: others, a time, a watcher. */
  paused: { fg: colours.amberSoft, bg: colours.amberTint, dot: colours.amber },
  /** Something failed or was refused. */
  alert: { fg: colours.claySoft, bg: colours.clayTint, dot: colours.clay },
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

/** The pilot, Autopilot's mascot: Claude's pixel mascot in pilot green, with aviators and a captain's cap whose badge is Claude's clay. 16×12. */
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
    G: colours.clay,
    Y: colours.claySoft,
    K: '#0E0E0E',
    V: '#1A1A1A',
    A: '#17262E',
    h: '#9CC3D2',
  } as Record<string, string>,
} as const

/** Claude's own pixel mascot, in clay, for what a Claude session did. 16×8. */
export const claude = {
  rows: [
    '..CCCCCCCCCCCC..',
    '..CCKCCCCCCKCC..',
    '..CCKCCCCCCKCC..',
    'CCCCCCCCCCCCCCCC',
    '..CCCCCCCCCCCC..',
    '..CCCCCCCCCCCC..',
    '...C.C....C.C...',
    '...C.C....C.C...',
  ],
  colours: { C: colours.clay, K: colours.well } as Record<string, string>,
} as const
