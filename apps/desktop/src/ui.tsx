import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { pilot, space, type Space, type Tone } from '@autopilot/design'

/**
 * The window's building blocks. Screens compose these and lay themselves out with classes from
 * styles.css; a raw <button> or a style prop outside this file fails lint, so every button looks
 * like one of the kinds below and every colour comes from the tokens.
 */

const BUTTON_CLASS = {
  /** The one thing to do next. */
  primary: 'btn primary',
  /** An answer or a choice. */
  secondary: 'btn',
  /** A small action beside something. */
  tool: 'tool',
  /** A small action that should not draw the eye. */
  quiet: 'tool bare',
  link: 'link',
  /** A link or an attachment. */
  chip: 'chip',
  icon: 'icon-button',
  /** The round send arrow in a composer. */
  send: 'send',
  nav: 'nav-item',
  /** A row in a list; the list styles it. */
  row: 'row',
  /** A row in a short list of things, such as what a task links to. */
  item: 'item',
  /** An item in a menu; the menu styles it. */
  menu: '',
} as const

export type ButtonKind = keyof typeof BUTTON_CLASS

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & { kind?: ButtonKind }

export const Button = ({ kind = 'secondary', className, type = 'button', ...props }: ButtonProps) => (
  <button type={type} className={[BUTTON_CLASS[kind], className].filter(Boolean).join(' ') || undefined} {...props} />
)

export const SidebarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </svg>
)

export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
)

/** The arrow on a send button; it takes the button's colour. */
export const ArrowUp = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </svg>
)

/** A small round light: running, failing, paused. */
export const Dot = ({ tone, label }: { tone: Tone; label?: string }) => (
  <span className={`health-dot tone-${tone}`} role={label ? 'img' : undefined} aria-label={label} />
)

/** A line of news over a screen: something failed, or something worked. */
export const Banner = ({ tone = 'attention', children }: { tone?: Tone; children: ReactNode }) => (
  <div className={`banner tone-${tone}`} role="status">
    {children}
  </div>
)

type FlexProps = {
  gap?: Space
  align?: CSSProperties['alignItems']
  justify?: CSSProperties['justifyContent']
  wrap?: boolean
  /** Space above, from the spacing steps. */
  top?: Space
  className?: string
  children: ReactNode
}

const flex = (direction: 'row' | 'column', { gap = 0, align, justify, wrap, top }: FlexProps): CSSProperties => ({
  display: 'flex',
  flexDirection: direction,
  gap: space[gap],
  alignItems: align ?? (direction === 'row' ? 'center' : undefined),
  justifyContent: justify,
  flexWrap: wrap ? 'wrap' : undefined,
  marginTop: top === undefined ? undefined : space[top],
})

/** Things side by side, centred on one line unless told otherwise. */
export const Row = (props: FlexProps) => (
  <div className={props.className} style={flex('row', props)}>
    {props.children}
  </div>
)

export const Column = (props: FlexProps) => (
  <div className={props.className} style={flex('column', props)}>
    {props.children}
  </div>
)

/** Takes the free space in a row, pushing what follows to the end. */
export const Spacer = () => <span style={{ flex: 1 }} />

/** Quiet secondary text: ids, ages, explanations. */
export const Meta = ({
  top,
  as: Tag = 'div',
  className,
  children,
}: {
  top?: Space
  as?: 'div' | 'span' | 'p' | 'ol'
  className?: string
  children: ReactNode
}) => (
  <Tag className={className ? `meta ${className}` : 'meta'} style={top === undefined ? undefined : { marginTop: space[top] }}>
    {children}
  </Tag>
)

/** The pilot, Autopilot's mascot, drawn in squares. */
export const Pilot = ({ pixel = 1.5 }: { pixel?: number }) => (
  <div
    role="img"
    aria-label="Autopilot"
    style={{ display: 'grid', gridTemplateColumns: `repeat(16, ${pixel}px)`, gridAutoRows: `${pixel}px`, flex: 'none' }}
  >
    {pilot.rows.flatMap((row, y) =>
      [...row].map((cell, x) => <span key={`${y}-${x}`} style={{ background: pilot.colours[cell] ?? 'transparent' }} />),
    )}
  </div>
)
