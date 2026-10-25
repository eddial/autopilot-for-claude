import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colours, fonts, pilot, radius, space, tones, type Tone } from '@autopilot/design'

/**
 * The phone's building blocks, the same kinds as the Mac window's `src/ui.tsx` and from the same
 * tokens. Screens compose these; a colour written anywhere else fails the tokens test.
 */

/** Text styles every screen shares. */
export const type = StyleSheet.create({
  title: { fontFamily: fonts.serifNative, fontSize: 24, lineHeight: 30, color: colours.text },
  heading: { fontFamily: fonts.serifNative, fontSize: 28, color: colours.text },
  body: { fontSize: 16, lineHeight: 24, color: colours.textBody },
  name: { flex: 1, fontSize: 16, color: colours.textBody },
  lead: { fontSize: 15, lineHeight: 22, color: colours.text2 },
  meta: { fontSize: 13, color: colours.text3 },
  note: { fontSize: 14, lineHeight: 20, color: colours.text3, padding: space[3] },
})

export const Card = ({ children }: { children: ReactNode }) => <View style={styles.card}>{children}</View>

/** A card's first line: a dot, a name, and whatever goes at the end. */
export const CardHead = ({ children }: { children: ReactNode }) => <View style={styles.head}>{children}</View>

export const Dot = ({ tone }: { tone: Tone }) => <View style={[styles.dot, { backgroundColor: tones[tone].dot }]} />

/** A line of news: offline, refused, failed, or done. */
export const Banner = ({ tone = 'attention', children }: { tone?: Tone; children: ReactNode }) => (
  <View style={[styles.banner, { backgroundColor: tones[tone].bg }]}>
    {typeof children === 'string' ? <Text style={[styles.bannerText, { color: tones[tone].fg }]}>{children}</Text> : children}
  </View>
)

export const bannerText = (tone: Tone = 'attention') => [styles.bannerText, { color: tones[tone].fg }]

/** A small choice or link; `on` when it is the chosen one. */
export const Chip = ({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) => (
  <Pressable
    style={[styles.chip, on && styles.chipOn]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={on === undefined ? undefined : { selected: on }}
  >
    <Text style={[styles.chipText, on && { color: colours.text }]}>{label}</Text>
  </Pressable>
)

const BUTTON = {
  /** The one thing to do next. */
  primary: { box: { backgroundColor: colours.clay }, text: { color: colours.well, fontWeight: '600' } },
  /** An answer to a question. */
  option: { box: { backgroundColor: colours.button, borderWidth: StyleSheet.hairlineWidth, borderColor: colours.borderStrong }, text: {} },
  /** Anything else. */
  secondary: { box: { backgroundColor: colours.raised }, text: {} },
  /** Undoes something that matters. */
  destructive: { box: { backgroundColor: colours.raised }, text: { color: colours.claySoft } },
} as const

export const Button = ({
  label,
  kind = 'secondary',
  onPress,
  style,
}: {
  label: string
  kind?: keyof typeof BUTTON
  onPress: () => void
  style?: StyleProp<ViewStyle>
}) => (
  <Pressable style={[styles.button, BUTTON[kind].box, style]} onPress={onPress} accessibilityRole="button">
    <Text style={[styles.buttonText, BUTTON[kind].text]}>{label}</Text>
  </Pressable>
)

/** The pilot, Autopilot's mascot, drawn in squares. */
export const Pilot = ({ pixel = 3 }: { pixel?: number }) => (
  <View accessibilityRole="image" accessibilityLabel="Autopilot">
    {pilot.rows.map((row, y) => (
      <View key={y} style={styles.pilotRow}>
        {[...row].map((cell, x) => (
          <View key={x} style={{ width: pixel, height: pixel, backgroundColor: pilot.colours[cell] ?? 'transparent' }} />
        ))}
      </View>
    ))}
  </View>
)

const styles = StyleSheet.create({
  card: {
    padding: space[6],
    borderRadius: radius.lg,
    backgroundColor: colours.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.border,
    gap: space[2],
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.md, gap: space[3] },
  bannerText: { fontSize: 14 },
  chip: {
    paddingHorizontal: space[5],
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
  },
  chipOn: { backgroundColor: colours.raised, borderColor: colours.clay },
  chipText: { fontSize: 14, color: colours.text2 },
  button: { paddingHorizontal: space[6], paddingVertical: 9, borderRadius: radius.md, alignSelf: 'flex-start' },
  buttonText: { fontSize: 15, color: colours.text },
  pilotRow: { flexDirection: 'row' },
})
