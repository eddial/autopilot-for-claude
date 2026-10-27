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
  // Urgent in a list, as Linear marks it: the one bright orange.
  urgent: '#F2782F',
  urgentInk: '#FFFFFF',
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

/**
 * The same roles in light, after the Claude app's light theme: warm paper, near-black ink, and the
 * accents a step darker so their text reads on the paler tints. The Mac window switches between
 * the two with the Claude app's setting (light, dark or the system's).
 */
export const lightColours: Record<Colour, string> = {
  well: '#EFEEEA',
  window: '#F8F8F6',
  surface: '#FFFFFF',
  open: '#F7F7F5',
  raised: '#FFFFFF',
  button: '#EDECE8',
  buttonHover: '#E3E2DD',
  grip: '#C2C0B6',

  text: '#141413',
  textBody: '#1F1E1D',
  textSoft: '#30302E',
  text2: '#5E5D59',
  text3: '#73726C',
  muted: '#9C9A92',

  clay: '#C6613F',
  claySoft: '#A9472A',
  clayTint: 'rgba(198, 97, 63, 0.12)',
  urgent: '#F06A1F',
  urgentInk: '#FFFFFF',
  pilot: '#3E9A76',
  pilotSoft: '#2B7A5B',
  pilotTint: 'rgba(62, 154, 118, 0.14)',
  amber: '#B7862C',
  amberSoft: '#8A6418',
  amberTint: 'rgba(183, 134, 44, 0.16)',

  border: 'rgba(31, 30, 29, 0.12)',
  borderStrong: 'rgba(31, 30, 29, 0.2)',
  hover: 'rgba(0, 0, 0, 0.04)',
  press: 'rgba(0, 0, 0, 0.07)',
  scrim: 'rgba(0, 0, 0, 0.25)',
  shadow: 'rgba(0, 0, 0, 0.16)',
}

/** Which colour each part of a tone is, by name, so the window's tones follow its theme. */
export const toneColours = {
  pilot: { fg: 'pilotSoft', bg: 'pilotTint', dot: 'pilot' },
  claude: { fg: 'claySoft', bg: 'clayTint', dot: 'clay' },
  paused: { fg: 'amberSoft', bg: 'amberTint', dot: 'amber' },
  alert: { fg: 'claySoft', bg: 'clayTint', dot: 'clay' },
  quiet: { fg: 'text3', bg: 'hover', dot: 'muted' },
} as const satisfies Record<string, Record<'fg' | 'bg' | 'dot', Colour>>

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
  /** Headings, Source Serif on both: bundled in the window, embedded in the iPhone app (expo-font, by its PostScript name). */
  serif: "'Anthropic Serif', 'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif",
  serifNative: 'SourceSerif4-Regular',
  sans: "'Anthropic Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: 'ui-monospace, Menlo, monospace',
} as const

export const radius = { sm: 8, md: 10, lg: 12, xl: 18, round: 999 } as const

/**
 * The shape of each building block both apps draw: its corner, its edge and its fill, by colour
 * name. The Mac reads them as `--shape-<block>-<part>` variables, the phone imports them, so a
 * row or a button cannot drift between the two. The Mac's look leads: change it here, not in one app.
 */
export const shapes = {
  /** A task in the list: edged like the buttons above it, so the column reads as one set. */
  row: { radius: radius.md, edge: 'borderStrong', fill: 'surface', selected: 'button' },
  /** The status tabs: a well with the chosen tab lifted out of it. */
  tabs: { radius: radius.md },
  tab: { radius: radius.sm, edge: 'borderStrong', selected: 'raised' },
  /** An answer, Snooze, Mark done: everything that is not the one primary action. */
  button: { radius: 9, edge: 'borderStrong', fill: 'raised' },
  /** A small choice or link inside the page. */
  chip: { radius: 7, edge: 'borderStrong', fill: 'raised' },
  /** A panel of facts: status, workstream, where it came from. */
  card: { radius: radius.lg, edge: 'border', fill: 'surface' },
  /** What waits on you: a question or a decision, in the activity. */
  ask: { radius: 14, edge: 'borderStrong', fill: 'surface' },
} as const satisfies Record<
  string,
  { radius: number; edge?: keyof typeof colours; fill?: keyof typeof colours; selected?: keyof typeof colours }
>

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

/**
 * A tumbleweed, rolling across a list with nothing in it: a loose ball of dry twigs, the far side
 * darker than the near, a few ends sticking out. Greyscale and faint. 16×16.
 */
export const tumbleweed = {
  rows: [
    '......L..M......',
    '....MM.LM..M....',
    '...M..MD.M.LM...',
    '..L.MD..M..D.M..',
    '.M.D..LM.DM...L.',
    '.M..MD...M..DM..',
    'M.DM..L.MD.M..M.',
    '.MD..MMD..L..DM.',
    'M..LD..M.DM.M..M',
    '.M..M.D..M..D.M.',
    '..MD..LM.D.MM.L.',
    '.L..MD..M..D.M..',
    '..M..M.DM.LM..M.',
    '...ML..M..D.M...',
    '....M.MD.ML.....',
    '......M..M......',
  ],
  colours: { L: colours.text2, M: colours.text3, D: colours.muted } as Record<string, string>,
} as const

/** A small cactus on the horizon the tumbleweed crosses, so the line reads as ground. 16×12. */
export const cactus = {
  rows: [
    '.......D........',
    '......DDD.......',
    '......DDD..D....',
    '.D....DDD..D....',
    '.D....DDD..D....',
    '.D....DDDDDD....',
    '.DDDDDDDD.......',
    '......DDD.......',
    '......DDD.......',
    '......DDD.......',
    '......DDD.......',
    '......DDD.......',
  ],
  colours: { D: colours.muted } as Record<string, string>,
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
