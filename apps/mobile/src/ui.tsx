import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { claude, colours, fonts, pilot, radius, space, tones, type Tone } from '@autopilot/design'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { SafeAreaView } from 'react-native-safe-area-context'
import { linkKind, parseMarkdown, type Inline, type LinkKind } from '@autopilot/client'

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
  /** Section labels: small capitals, quiet. */
  label: { fontSize: 11.5, fontWeight: '500', letterSpacing: 0.7, textTransform: 'uppercase', color: colours.text3 },
})

/** Where something stands, in a tone: "Your turn", "Running". */
export const Pill = ({ tone, label }: { tone: Tone; label: string }) => (
  <View style={[styles.pill, { backgroundColor: tone === 'quiet' ? colours.raised : tones[tone].bg }]}>
    <Text style={[styles.pillText, { color: tone === 'quiet' ? colours.text2 : tones[tone].fg }]}>{label}</Text>
  </View>
)

/** A quiet property: a workstream, a priority. */
export const Tag = ({ label }: { label: string }) => (
  <View style={[styles.pill, styles.tag]}>
    <Text style={[styles.pillText, { color: colours.text2 }]}>{label}</Text>
  </View>
)

type Who = 'owner' | 'session' | 'watcher' | 'signal' | 'system' | 'scout'

const AVATAR: Record<Exclude<Who, 'system' | 'scout' | 'session'>, { symbol: SFSymbol; fg: string; bg: string }> = {
  // A watcher in amber (paused on something), a signal in green, you in white.
  watcher: { symbol: 'eye', fg: colours.amber, bg: colours.raised },
  owner: { symbol: 'person.fill', fg: colours.text, bg: colours.raised },
  signal: { symbol: 'bolt.fill', fg: colours.pilot, bg: colours.raised },
}

/** Who did something in a task's timeline, as on the Mac: the pilot for Autopilot, Claude for its session, a symbol for the rest. */
export const Avatar = ({ who }: { who: Who }) => {
  if (who === 'system' || who === 'scout' || who === 'session')
    return (
      <View style={[styles.avatar, { backgroundColor: colours.raised }]}>
        {who === 'session' ? <Mascot art={claude} pixel={1} label="Claude" /> : <Pilot pixel={1} />}
      </View>
    )
  const a = AVATAR[who]
  return (
    <View style={[styles.avatar, { backgroundColor: a.bg }]}>
      <SymbolView name={a.symbol} size={12} tintColor={a.fg} />
    </View>
  )
}

/**
 * A screen's content kept clear of what sits at its sides: on the Duo's outer display, and on the
 * inner one in landscape, the vertical bar takes the hardware edge. Top and bottom are the scroll
 * view's (contentInsetAdjustmentBehavior); the sides are measured where this view sits.
 */
export const Sides = ({ children, colour }: { children: ReactNode; colour?: string }) => (
  <SafeAreaView edges={['left', 'right']} style={[styles.sides, colour ? { backgroundColor: colour } : null]}>
    {children}
  </SafeAreaView>
)

const Inlines = ({ inlines, onLink }: { inlines: Inline[]; onLink: (url: string) => void }) =>
  inlines.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text
      case 'strong':
        return (
          <Text key={i} style={styles.strong}>
            {n.text}
          </Text>
        )
      case 'em':
        return (
          <Text key={i} style={styles.em}>
            {n.text}
          </Text>
        )
      case 'code':
        return (
          <Text key={i} style={styles.code}>
            {n.text}
          </Text>
        )
      case 'link':
        return (
          <Text key={i} style={styles.link} onPress={() => onLink(n.url)} accessibilityRole="link">
            {n.text}
          </Text>
        )
    }
  })

/** Markdown as sessions write it (`parseMarkdown`, shared with the Mac), in native text. */
export const Markdown = ({ text, onLink }: { text: string; onLink: (url: string) => void }) => (
  <View style={styles.md}>
    {parseMarkdown(text).map((b, i) =>
      b.kind === 'rule' ? (
        <View key={i} style={styles.mdRule} />
      ) : b.kind === 'heading' ? (
        <Text key={i} style={[type.body, styles.mdHeading]}>
          <Inlines inlines={b.inlines} onLink={onLink} />
        </Text>
      ) : b.kind === 'list' ? (
        <View key={i} style={styles.mdList}>
          {b.items.map((item, j) => (
            <View key={j} style={styles.mdItem}>
              <Text style={[type.body, styles.mdMark]}>{b.ordered ? `${j + 1}.` : '•'}</Text>
              <Text style={[type.body, styles.mdItemText]}>
                <Inlines inlines={item} onLink={onLink} />
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text key={i} style={type.body}>
          {b.lines.map((line, j) => (
            <Text key={j}>
              {j > 0 ? '\n' : ''}
              <Inlines inlines={line} onLink={onLink} />
            </Text>
          ))}
        </Text>
      ),
    )}
  </View>
)

const KIND_SYMBOL: Record<LinkKind['icon'], SFSymbol> = {
  document: 'doc.text',
  code: 'chevron.left.forwardslash.chevron.right',
  mail: 'envelope',
  link: 'link',
  image: 'photo',
  table: 'tablecells',
}

/** What kind of thing a link is, as the system draws it. */
export const LinkIcon = ({ link, size = 14 }: { link: { url: string; title: string }; size?: number }) => (
  <SymbolView name={KIND_SYMBOL[linkKind(link).icon]} size={size} tintColor={colours.text3} />
)

export const Card = ({ children }: { children: ReactNode }) => <View style={styles.card}>{children}</View>

/** A card's first line: a dot, a name, and whatever goes at the end. */
export const CardHead = ({ children }: { children: ReactNode }) => <View style={styles.head}>{children}</View>

export const Dot = ({ tone }: { tone: Tone }) => <View style={[styles.dot, { backgroundColor: tones[tone].dot }]} />

/** A line of news: offline, refused, failed, or done. */
export const Banner = ({ tone = 'alert', children }: { tone?: Tone; children: ReactNode }) => (
  <View style={[styles.banner, { backgroundColor: tones[tone].bg }]}>
    {typeof children === 'string' ? <Text style={[styles.bannerText, { color: tones[tone].fg }]}>{children}</Text> : children}
  </View>
)

export const bannerText = (tone: Tone = 'alert') => [styles.bannerText, { color: tones[tone].fg }]

/** A small choice or link; `on` when it is the chosen one. */
export const Chip = ({ label, on, icon, onPress }: { label: string; on?: boolean; icon?: ReactNode; onPress: () => void }) => (
  <Pressable
    style={[styles.chip, on && styles.chipOn, icon ? styles.chipWithIcon : null]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={on === undefined ? undefined : { selected: on }}
  >
    {icon}
    <Text style={[styles.chipText, on && { color: colours.text }]} numberOfLines={1}>
      {label}
    </Text>
  </Pressable>
)

const BUTTON = {
  /** The one thing to do next. */
  primary: { box: { backgroundColor: colours.pilot }, text: { color: colours.well, fontWeight: '600' } },
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

/** Pixel art drawn in squares: the pilot, or Claude. */
const Mascot = ({
  art,
  pixel,
  label,
}: {
  art: { rows: readonly string[]; colours: Record<string, string> }
  pixel: number
  label: string
}) => (
  <View accessibilityRole="image" accessibilityLabel={label}>
    {art.rows.map((row, y) => (
      <View key={y} style={styles.pilotRow}>
        {[...row].map((cell, x) => (
          <View key={x} style={{ width: pixel, height: pixel, backgroundColor: art.colours[cell] ?? 'transparent' }} />
        ))}
      </View>
    ))}
  </View>
)

/** The pilot, Autopilot's mascot. */
export const Pilot = ({ pixel = 3 }: { pixel?: number }) => <Mascot art={pilot} pixel={pixel} label="Autopilot" />

const styles = StyleSheet.create({
  sides: { flex: 1 },
  chipWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  md: { gap: space[2] },
  mdHeading: { fontWeight: '600', color: colours.text },
  mdList: { gap: 3 },
  mdRule: { height: StyleSheet.hairlineWidth, backgroundColor: colours.border, marginVertical: space[2] },
  mdItem: { flexDirection: 'row', gap: 8 },
  mdMark: { color: colours.text3, minWidth: 14 },
  mdItemText: { flex: 1 },
  strong: { fontWeight: '600', color: colours.text },
  em: { fontStyle: 'italic' },
  code: { fontFamily: 'Menlo', fontSize: 14, color: colours.text },
  link: { color: colours.pilotSoft, textDecorationLine: 'underline' },
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
  chipOn: { backgroundColor: colours.raised, borderColor: colours.pilot },
  chipText: { fontSize: 14, color: colours.text2 },
  button: { paddingHorizontal: space[6], paddingVertical: 9, borderRadius: radius.md, alignSelf: 'flex-start' },
  buttonText: { fontSize: 15, color: colours.text },
  pilotRow: { flexDirection: 'row' },
  pill: { paddingHorizontal: space[4], paddingVertical: 3, borderRadius: radius.round },
  tag: { borderWidth: StyleSheet.hairlineWidth, borderColor: colours.borderStrong },
  pillText: { fontSize: 13 },
  avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
