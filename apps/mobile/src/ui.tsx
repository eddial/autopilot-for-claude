import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native'
import {
  claude,
  colours,
  fonts,
  cactus,
  MARKS,
  pilot,
  radius,
  shapes,
  space,
  tones,
  tumbleweed,
  type Mark,
  type Tone,
} from '@autopilot/design'
import Svg, { Circle, Path } from 'react-native-svg'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { SafeAreaProvider, SafeAreaView, useSafeAreaFrame, useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context'
import { emptyWords, linkKind, parseMarkdown, workstreamMark, type Inline, type LinkKind } from '@autopilot/client'

/**
 * The phone's building blocks, the same kinds as the Mac window's `src/ui.tsx` and from the same
 * tokens. Screens compose these; a colour written anywhere else fails the tokens test.
 */

/**
 * The line a screen's first and last things sit on, from the top and bottom edges. On the Duo's
 * outer screen the camera and the side bar's last button are centred this far in; a screen's title
 * and its bottom bar are centred on the same lines, so each lines up with what is beside it.
 */
export const EDGE = 48

/** The margin at a screen's sides: titles, cards, bars and the composer all start and end on it. */
export const GUTTER = 16

/**
 * Space between an edge and a block `height` tall, so its middle sits on EDGE. At the top, never
 * under the status bar (`inset`); at the bottom the home indicator's inset is left out, as iOS
 * leaves it out for its own bottom bars, which sit on the same line.
 */
export const edgeSpace = (height: number, inset = 0): number => Math.max(inset + 8, EDGE - height / 2)

/** A building block's shape from the shared tokens (the Mac's look): its corner, edge and fill. */
export const shaped = (name: keyof typeof shapes) => {
  const shape: { radius: number; edge?: keyof typeof colours; fill?: keyof typeof colours } = shapes[name]
  return {
    borderRadius: shape.radius,
    ...(shape.edge ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colours[shape.edge] } : {}),
    ...(shape.fill ? { backgroundColor: colours[shape.fill] } : {}),
  }
}

/** Text styles every screen shares. */
export const type = StyleSheet.create({
  title: { fontFamily: fonts.serifNative, fontSize: 24, lineHeight: 30, color: colours.text },
  heading: { fontFamily: fonts.serifNative, fontSize: 28, lineHeight: 34, color: colours.text },
  body: { fontSize: 16, lineHeight: 24, color: colours.textBody },
  name: { flex: 1, fontSize: 16, color: colours.textBody },
  lead: { fontSize: 15, lineHeight: 22, color: colours.text2 },
  meta: { fontSize: 13, color: colours.text3 },
  note: { fontSize: 14, lineHeight: 20, color: colours.text3, padding: space[3] },
  /** Section labels: small capitals, quiet. */
  label: { fontSize: 13, fontWeight: '500', color: colours.text2 },
})

/** Where something stands, in a tone: "Your turn", "Running". */
export const Pill = ({ tone, label }: { tone: Tone; label: string }) => (
  <View style={[styles.pill, { backgroundColor: tone === 'quiet' ? colours.raised : tones[tone].bg }]}>
    <Text style={[styles.pillText, { color: tone === 'quiet' ? colours.text2 : tones[tone].fg }]}>{label}</Text>
  </View>
)

/**
 * Priority as Linear draws it, in grey: three bars with high all lit and low one, urgent a square
 * with "!". In a list (`listed`) urgent turns bright orange. The Mac's, drawn the same.
 */
export const Bars = ({ priority, listed = false }: { priority: number; listed?: boolean }) => {
  const label = ['Urgent', 'High priority', 'Normal priority', 'Low priority'][priority - 1]
  if (priority === 1)
    return (
      <View style={[styles.urgent, listed && { backgroundColor: colours.urgent }]} accessibilityLabel={label}>
        <Text style={[styles.urgentText, listed && { color: colours.urgentInk }]}>!</Text>
      </View>
    )
  return (
    <View style={styles.bars} accessibilityLabel={label}>
      {[5, 8, 11].map((height, i) => (
        <View key={height} style={[styles.bar, { height }, i + 1 <= 5 - priority && { backgroundColor: colours.text2 }]} />
      ))}
    </View>
  )
}

/** Not started yet, waiting to be triaged, as Linear marks it: arrows both ways on an orange disc. */
export const TriageMark = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" accessibilityLabel="Triage">
    <Circle cx={7} cy={7} r={7} fill={colours.urgent} />
    <Path
      d="M3.6 7h6.8M5.4 5.2 3.6 7l1.8 1.8M8.6 5.2 10.4 7 8.6 8.8"
      fill="none"
      stroke={colours.urgentInk}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
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
  watcher: { symbol: 'eye', fg: colours.amber, bg: colours.surface },
  owner: { symbol: 'person.fill', fg: colours.text, bg: colours.surface },
  signal: { symbol: 'bolt.fill', fg: colours.pilot, bg: colours.surface },
}

/** Who did something in a task's timeline, as on the Mac: the pilot for Autopilot, Claude for its session, a symbol for the rest. */
export const Avatar = ({ who }: { who: Who }) => {
  if (who === 'system' || who === 'scout' || who === 'session')
    return (
      <View style={[styles.avatar, { backgroundColor: colours.surface }]}>
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
// The last insets measured for each place a Sides sits (its edges, in this window size), so the
// next one starts from them: a task opened beside the list would otherwise draw a frame without the
// Duo's bar, its composer too wide, then shrink.
const measured = new Map<string, Metrics>()

const Remember = ({ place }: { place: string }) => {
  const insets = useSafeAreaInsets()
  const frame = useSafeAreaFrame()
  useEffect(() => {
    measured.set(place, { insets, frame })
  }, [place, insets, frame])
  return null
}

export const Sides = ({
  children,
  colour,
  edges = ['left', 'right'],
}: {
  children: ReactNode
  colour?: string
  /** The screen edges this view touches: the split's list column only the left, its task only the right. */
  edges?: ('left' | 'right')[]
}) => {
  const { width, height } = useWindowDimensions()
  const place = `${edges.join(',')}:${width}x${height}`
  return (
    // Its own provider, measured where the screen is: iOS puts the Duo's bar inside the window in
    // split view and reports it in the screen's safe area, which the app's root provider never sees.
    <SafeAreaProvider style={[styles.sides, colour ? { backgroundColor: colour } : null]} initialMetrics={measured.get(place) ?? null}>
      <Remember place={place} />
      <SafeAreaView edges={edges} style={styles.sides}>
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

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
/** How many letters a table cell holds. */
const cellLength = (cell: Inline[] | undefined) => (cell ?? []).reduce((n, part) => n + part.text.length, 0)

/** A table column wide enough for its longest cell, within reason: about 7.5 points a letter. */
const columnWidth = (table: { head: Inline[][]; rows: Inline[][][] }, c: number) => {
  const longest = Math.max(cellLength(table.head[c]), ...table.rows.map((row) => cellLength(row[c])))
  return Math.min(220, Math.max(56, longest * 7.5 + 20))
}

/** Parsed once per text: typing in the composer redraws the page, not the parse. */
export const Markdown = memo(function Markdown({ text, onLink }: { text: string; onLink: (url: string) => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <View style={styles.md}>
      {blocks.map((b, i) =>
        b.kind === 'rule' ? (
          <View key={i} style={styles.mdRule} />
        ) : b.kind === 'heading' ? (
          <Text key={i} style={[type.body, styles.mdHeading]}>
            <Inlines inlines={b.inlines} onLink={onLink} />
          </Text>
        ) : b.kind === 'table' ? (
          // Columns sized to their longest cell so rows line up; a wide table scrolls sideways.
          <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {[b.head, ...b.rows].map((row, r) => (
                <View key={r} style={[styles.mdRow, r === 0 && styles.mdHeadRow]}>
                  {row.map((cell, c) => (
                    <Text
                      key={c}
                      style={[
                        type.body,
                        styles.mdCell,
                        { width: columnWidth(b, c), textAlign: b.align[c] ?? 'left' },
                        r === 0 && { color: colours.text2 },
                      ]}
                    >
                      <Inlines inlines={cell} onLink={onLink} />
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
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
})

const KIND_SYMBOL: Record<LinkKind['icon'], SFSymbol> = {
  document: 'doc.text',
  code: 'chevron.left.forwardslash.chevron.right',
  mail: 'envelope',
  link: 'link',
  image: 'photo',
  table: 'tablecells',
}

/** Where something lives, as its maker draws it, in grey; a little smaller than a symbol, as on the Mac. */
export const SourceMark = ({ mark, size = 14 }: { mark: Mark; size?: number }) => (
  <Svg width={size} height={size} viewBox="-2.5 -2.5 29 29" fill={colours.text3}>
    <Path d={MARKS[mark]} />
  </Svg>
)

/** Where a link lives, by its mark; what kind of thing it is, as the system draws it, where it has none. */
export const LinkIcon = ({ link, size = 14 }: { link: { url: string; title: string }; size?: number }) => {
  const kind = linkKind(link)
  return kind.mark ? (
    <SourceMark mark={kind.mark} size={size} />
  ) : (
    <SymbolView name={KIND_SYMBOL[kind.icon]} size={size} tintColor={colours.text3} />
  )
}

const MARK_TONE = {
  pilot: { bg: colours.pilotTint, fg: colours.pilotSoft },
  clay: { bg: colours.clayTint, fg: colours.claySoft },
  amber: { bg: colours.amberTint, fg: colours.amberSoft },
  quiet: { bg: colours.raised, fg: colours.text2 },
}

/** A workstream's badge: its two letters on its tint, as on the Mac. */
export const WorkstreamBadge = ({ name }: { name: string }) => {
  const mark = workstreamMark(name)
  return (
    <View style={[styles.badge, { backgroundColor: MARK_TONE[mark.tone].bg }]}>
      <Text style={[styles.badgeText, { color: MARK_TONE[mark.tone].fg }]}>{mark.letters}</Text>
    </View>
  )
}

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
/** Liquid Glass where iOS has it (26 and later); before that, the solid fill the shape names. */
const GLASS = isLiquidGlassAvailable()

/**
 * What floats over the page (the composer, its round tools, the pills above it) is Liquid Glass,
 * as iOS draws its own bars; what is content (rows, cards) stays solid. Interactive glass answers
 * a touch with the system's own shimmer.
 */
export const Glass = ({
  style,
  interactive = false,
  children,
}: {
  style: StyleProp<ViewStyle>
  interactive?: boolean
  children: ReactNode
}) =>
  GLASS ? (
    <GlassView style={[style, styles.glass]} isInteractive={interactive}>
      {children}
    </GlassView>
  ) : (
    <View style={style}>{children}</View>
  )

export const Chip = ({
  label,
  on,
  icon,
  pill = false,
  onPress,
}: {
  label: string
  on?: boolean
  icon?: ReactNode
  /** Round and filled, as Claude's composer draws its choices (the model, the environment). */
  pill?: boolean
  onPress: () => void
}) => {
  const content = (
    <>
      {icon}
      <Text style={[styles.chipText, on && { color: colours.text }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  )
  const a11y = { accessibilityRole: 'button' as const, accessibilityState: on === undefined ? undefined : { selected: on } }
  // A pill floats over the composer: glass, with the press area filling it.
  if (pill)
    return (
      <Glass style={[styles.chipPill, { paddingHorizontal: 0 }]} interactive>
        <Pressable style={[styles.chipPillPress, icon ? styles.chipWithIcon : null]} onPress={onPress} {...a11y}>
          {content}
        </Pressable>
      </Glass>
    )
  return (
    <Pressable style={[styles.chip, on && styles.chipOn, icon ? styles.chipWithIcon : null]} onPress={onPress} {...a11y}>
      {content}
    </Pressable>
  )
}

const BUTTON = {
  /** The one thing to do next. */
  primary: { box: { backgroundColor: colours.text }, text: { color: colours.surface, fontWeight: '600' } },
  /** An answer to a question. */
  option: { box: shaped('button'), text: {} },
  /** Anything else. */
  secondary: { box: shaped('button'), text: {} },
  /** Undoes something that matters. */
  destructive: { box: { backgroundColor: colours.raised }, text: { color: colours.claySoft } },
} as const

export const Button = ({
  label,
  kind = 'secondary',
  onPress,
  disabled = false,
  style,
}: {
  label: string
  kind?: keyof typeof BUTTON
  onPress: () => void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) => (
  <Pressable
    style={[styles.button, BUTTON[kind].box, disabled && styles.disabled, style]}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityState={{ disabled }}
  >
    <Text style={[styles.buttonText, BUTTON[kind].text]}>{label}</Text>
  </Pressable>
)

/**
 * One item of a checklist: ticked by a tap, or by the app when it can tell for itself (`known`),
 * then not untickable. What to do under the title; anything else (a button) below that.
 */
export const Check = ({
  done,
  known = false,
  title,
  detail,
  onToggle,
  children,
}: {
  done: boolean
  known?: boolean
  title: string
  detail: string
  onToggle: () => void
  children?: ReactNode
}) => (
  <Pressable
    style={styles.check}
    onPress={known ? undefined : onToggle}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: done }}
  >
    <SymbolView name={done ? 'checkmark.circle.fill' : 'circle'} size={22} tintColor={done ? colours.pilot : colours.borderStrong} />
    <View style={styles.checkText}>
      <Text style={[type.name, { flex: 0 }, done && styles.checkDone]}>{title}</Text>
      <Text style={type.meta}>{detail}</Text>
      {children}
    </View>
  </Pressable>
)

/**
 * A box to write in, as Claude's own: the text on top, under it the tools on the left and a round
 * send on the right. New task and a task's reply both use it.
 */
export const Composer = ({
  children,
  tools,
  ready,
  onSend,
  sendLabel = 'Send',
}: {
  children: ReactNode
  tools?: ReactNode
  ready: boolean
  onSend: () => void
  sendLabel?: string
}) => (
  <Glass style={styles.composer}>
    {children}
    <View style={styles.composerBar}>
      <View style={styles.composerTools}>{tools}</View>
      <Pressable
        style={[styles.composerSend, !ready && styles.disabled]}
        onPress={onSend}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={sendLabel}
      >
        <SymbolView name="arrow.up" size={16} weight="semibold" tintColor={colours.window} />
      </Pressable>
    </View>
  </Glass>
)

/** Twice the distance from the composer's bottom edge to the middle of its send: what edgeSpace centres. */
export const COMPOSER_BAR = 56

/** A round tool in the composer's bar: attach, and the like. */
export const ComposerTool = ({ symbol, label, onPress }: { symbol: SFSymbol; label: string; onPress: () => void }) => (
  <Glass style={styles.composerTool} interactive>
    <Pressable style={styles.fill} onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={symbol} size={18} tintColor={colours.text} />
    </Pressable>
  </Glass>
)

/**
 * Space under a screen's last row (the tabs, the composer), `height` tall. Beside the Duo's vertical
 * bar it is centred on the edge line, level with the bar's last button; where iOS lays its bar across
 * the bottom (the inner display in portrait) that bar is in the safe area, and the row sits above it.
 * Read inside `Sides` (or `KeyboardScreen`), whose provider measures the screen itself.
 */
export const useBottomGap = (height: number): number => {
  const { bottom } = useSafeAreaInsets()
  return bottom > 40 ? bottom + 8 : edgeSpace(height)
}

/**
 * A screen that keeps its composer above the keyboard, as Claude's does: its bottom padding is
 * exactly how far the keyboard reaches into it, plus a small gap, measured in the window, so a
 * pushed screen, a sheet and a split-view half all come out the same. With the keyboard down the
 * composer sits on the edge line beside the bar's last button.
 */
export const KeyboardScreen = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => {
  const box = useRef<ComponentRef<typeof View>>(null)
  const [covered, setCovered] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      box.current?.measureInWindow((_x, y, _w, height) => setCovered(Math.max(0, y + height - e.endCoordinates.screenY)))
    })
    const hide = Keyboard.addListener('keyboardWillHide', () => setCovered(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return (
    <View ref={box} style={{ flex: 1 }}>
      <SafeAreaProvider style={{ flex: 1 }}>
        <BottomGap covered={covered} style={style}>
          {children}
        </BottomGap>
      </SafeAreaProvider>
    </View>
  )
}

/** The keyboard's reach plus a small gap while it is up; the bottom gap otherwise. The screen's own style (its gaps) applies here, around its children. */
const BottomGap = ({ covered, style, children }: { covered: number; style?: StyleProp<ViewStyle>; children: ReactNode }) => {
  const gap = useBottomGap(COMPOSER_BAR)
  return <View style={[{ flex: 1 }, style, { paddingBottom: covered > 0 ? covered + 12 : gap }]}>{children}</View>
}

/** The composer's text field: grows with what is written, up to a point. */
export const composerInput = {
  minHeight: 44,
  maxHeight: 160,
  fontSize: 17,
  lineHeight: 23,
  color: colours.text,
  paddingHorizontal: 6,
} as const

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

/** A cloud going by behind the pilot, its speed and height its own; still when Reduce Motion is on. */
const Cloud = ({ top, width, seconds, delay, still }: { top: number; width: number; seconds: number; delay: number; still: boolean }) => {
  const [x] = useState(() => new Animated.Value(220))
  useEffect(() => {
    if (still) return
    const run = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(x, { toValue: -80, duration: seconds * 1000, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(x, { toValue: 220, duration: 0, useNativeDriver: true }),
      ]),
    )
    run.start()
    return () => run.stop()
  }, [x, seconds, delay, still])
  return <Animated.View style={[styles.cloud, { top, width, transform: [{ translateX: still ? 60 : x }] }]} />
}

/** An empty list, as on the Mac: the pilot drifting along past a few clouds, and a word about it. */
/** The pilot flying through drifting clouds, bobbing unless motion is reduced: the queue is clear. */
export const FlyingPilot = () => {
  const [still, setStill] = useState(false)
  const [bob] = useState(() => new Animated.Value(0))
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill)
  }, [])
  useEffect(() => {
    if (still) return
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    run.start()
    return () => run.stop()
  }, [bob, still])
  return (
    <View style={styles.sky} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Cloud top={18} width={44} seconds={9} delay={0} still={still} />
      <Cloud top={52} width={28} seconds={6} delay={1500} still={still} />
      <Cloud top={80} width={60} seconds={12} delay={3000} still={still} />
      <Animated.View
        style={[
          styles.flying,
          {
            transform: [
              { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
              { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) },
            ],
          },
        ]}
      >
        <Pilot pixel={4} />
      </Animated.View>
    </View>
  )
}

/** The tumbleweed's size, in points: 16 pixels of 1.75, a little shorter than the cactus. */
const WEED = 28
/** One crossing, then the wait before the next. */
const CROSSING = 7000
const LULL = 3500

/**
 * A faint tumbleweed crossing an empty list on a horizon in its middle, now and then. It rolls as
 * far as it turns (one turn per circumference), moves with the gusts (quick, easing, quick again),
 * hops lower each time it lands, and its shadow shrinks while it is in the air. Still, in the
 * middle, when motion is reduced.
 */
export const Tumbleweed = () => {
  const [width, setWidth] = useState(0)
  const [still, setStill] = useState(false)
  const [t] = useState(() => new Animated.Value(0))
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill)
  }, [])
  useEffect(() => {
    if (!width || still) return
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: CROSSING, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(LULL),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    )
    run.start()
    return () => run.stop()
  }, [t, width, still])
  // Where it is along the way: a gust, a lull, another gust.
  const along = t.interpolate({ inputRange: [0, 0.25, 0.55, 0.75, 1], outputRange: [0, 0.3, 0.52, 0.72, 1] })
  const distance = width + WEED * 2
  const x = along.interpolate({ inputRange: [0, 1], outputRange: [-WEED, width + WEED] })
  const turn = along.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(distance / (Math.PI * WEED)) * 360}deg`] })
  // Hops, each lower than the last, on the same clock.
  const hops = { inputRange: [0, 0.08, 0.16, 0.3, 0.42, 0.55, 0.64, 0.74, 0.86, 0.93, 1], height: [0, 16, 0, 0, 10, 0, 0, 6, 0, 3, 0] }
  const y = t.interpolate({ inputRange: hops.inputRange, outputRange: hops.height.map((h) => -h) })
  // The shadow on the ground: as wide as the ball when it touches down, smaller and fainter the
  // higher it is.
  const shadow = t.interpolate({ inputRange: hops.inputRange, outputRange: hops.height.map((h) => 1 - h / 22) })
  const shade = t.interpolate({ inputRange: hops.inputRange, outputRange: hops.height.map((h) => 0.55 - h / 40) })
  return (
    <View
      style={styles.tumble}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.stage}>
        <View style={[styles.cactus, { left: width * 0.72 }]}>
          <Mascot art={cactus} pixel={3.5} label="" />
        </View>
        <View style={styles.horizon} />
        {still ? (
          <View style={[styles.weed, { left: width / 2 - WEED / 2 }]}>
            <Mascot art={tumbleweed} pixel={WEED / 16} label="" />
          </View>
        ) : (
          <>
            <Animated.View style={[styles.weedShadow, { transform: [{ translateX: x }, { scaleX: shadow }], opacity: shade }]} />
            <Animated.View style={[styles.weed, { transform: [{ translateX: x }, { translateY: y }, { rotate: turn }] }]}>
              <Mascot art={tumbleweed} pixel={WEED / 16} label="" />
            </Animated.View>
          </>
        )}
      </View>
    </View>
  )
}

/**
 * An empty tab: the flying pilot with what the emptiness means. `quiet` when New task is beside it
 * (the split), which then carries the pilot: one line here, so the screen has one pilot, not two.
 */
export const EmptyList = ({ view, quiet = false }: { view: string | null; quiet?: boolean }) => {
  const words = emptyWords(view)
  // Beside New task, which says it in words: a tumbleweed rolls across the empty list, and that is
  // all. Hidden from VoiceOver, which hears the words beside it.
  if (quiet) return <Tumbleweed />
  return (
    <View style={styles.emptyList}>
      <FlyingPilot />
      <Text style={styles.emptyTitle}>{words.title}</Text>
      <Text style={styles.emptyLine}>{words.line}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  // As Claude's own: a rounded, lighter box on the dark ground, round 36-point buttons under the text.
  composer: {
    borderRadius: 26,
    backgroundColor: colours.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
    padding: 10,
    paddingTop: 14,
    gap: 10,
  },
  composerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  // Glass is its own fill and edge: none drawn under it.
  glass: { backgroundColor: 'transparent', borderWidth: 0 },
  fill: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  chipPillPress: { height: 36, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  composerTools: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  composerTool: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.button,
  },
  composerSend: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.clay },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  checkText: { flex: 1, gap: 4 },
  checkDone: { color: colours.text2 },
  mdRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colours.border },
  mdHeadRow: { borderBottomColor: colours.borderStrong },
  mdCell: { paddingVertical: 6, paddingRight: 12, fontSize: 15 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  bar: { width: 3, borderRadius: 1, backgroundColor: colours.borderStrong },
  urgent: { width: 13, height: 13, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.text2 },
  urgentText: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: colours.surface },
  sides: { flex: 1 },
  badge: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: '600' },
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
  card: { ...shaped('card'), padding: space[6], gap: space[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.md, gap: space[3] },
  bannerText: { fontSize: 14 },
  chip: { ...shaped('chip'), paddingHorizontal: space[5], paddingVertical: 7 },
  chipOn: { borderColor: colours.text },
  chipPill: {
    height: 36,
    paddingVertical: 0,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 0,
    backgroundColor: colours.button,
    justifyContent: 'center',
  },
  chipText: { fontSize: 14, color: colours.text },
  emptyList: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 28 },
  sky: { width: 200, height: 96, marginBottom: 18, overflow: 'hidden' },
  cloud: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: colours.borderStrong },
  flying: { position: 'absolute', top: 26, left: 68 },
  emptyTitle: { fontFamily: fonts.serifNative, fontSize: 22, color: colours.text },
  emptyLine: { marginTop: 6, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colours.text3, maxWidth: 300 },
  // Fills the empty list and puts the horizon in its middle.
  tumble: { flex: 1, minHeight: 160, justifyContent: 'center', overflow: 'hidden' },
  stage: { height: 72 },
  horizon: {
    position: 'absolute',
    left: GUTTER,
    right: GUTTER,
    bottom: 14,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colours.border,
  },
  cactus: { position: 'absolute', bottom: 14, opacity: 0.4 },
  weed: { position: 'absolute', bottom: 15, left: 0, width: WEED, height: WEED, opacity: 0.55 },
  // A soft dark ellipse lying on the ground line, centred under the ball.
  weedShadow: { position: 'absolute', bottom: 12, left: 2, width: WEED - 4, height: 4, borderRadius: 2, backgroundColor: colours.shadow },
  button: { paddingHorizontal: space[6], paddingVertical: 9, borderRadius: radius.md, alignSelf: 'flex-start' },
  buttonText: { fontSize: 15, color: colours.text },
  pilotRow: { flexDirection: 'row' },
  pill: { paddingHorizontal: space[4], paddingVertical: 3, borderRadius: radius.round },
  tag: { borderWidth: StyleSheet.hairlineWidth, borderColor: colours.borderStrong },
  pillText: { fontSize: 13 },
  avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
