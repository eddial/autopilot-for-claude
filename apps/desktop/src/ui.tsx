import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { parseMarkdown, workstreamMark, type Inline } from '@autopilot/client'
import { claude, pilot, space, type Space, type Tone } from '@autopilot/design'

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
  /** A value in a task's properties: quiet until hovered, then a button. */
  prop: 'prop-button',
  /** A step in the set-up stepper: open once reached. */
  step: 'step',
  /** A status tab above the list. */
  tab: 'tab',
  /** A workstream's header in the list, which folds its tasks away. */
  section: 'ws-head',
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

export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
)

const ICONS = {
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />,
  done: <path d="M3.5 8.5l3 3 6-7" />,
  /** The return key: Enter sends. */
  enter: <path d="M12.5 3.5V8a2 2 0 0 1-2 2H3.5M6.5 7l-3 3 3 3" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.5" />
    </>
  ),
  /** Opens a menu below. */
  more: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  dismiss: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
} as const

/** A small line icon for a button, in the button's colour. */
export const Icon = ({ name, size = 13 }: { name: keyof typeof ICONS; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {ICONS[name]}
  </svg>
)

/**
 * The places in the nav, in the manner of the Claude app's own: thin, rounded strokes on a 20-point
 * grid, open shapes, nothing filled.
 */
const NAV_ICONS = {
  plus: <path d="M10 5v10M5 10h10" />,
  inbox: (
    <>
      <path d="M3.5 11.25h3.4l.9 1.75h4.4l.9-1.75h3.4" />
      <path d="M5.7 4.5h8.6l2.2 6.75v3.25A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5v-3.25z" />
    </>
  ),
  /** Rays, like the iPhone's `rays`: a session at work. */
  running: (
    <path d="M10 3.25V6M10 14v2.75M3.25 10H6M14 10h2.75M5.2 5.2l1.95 1.95M12.85 12.85l1.95 1.95M5.2 14.8l1.95-1.95M12.85 7.15l1.95-1.95" />
  ),
  /** A clock: the next move is someone else's. */
  waiting: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6.25V10l2.5 1.5" />
    </>
  ),
  /** A moon: put away until later. */
  snoozed: <path d="M15.75 12.4A6.5 6.5 0 0 1 7.6 4.25a6.5 6.5 0 1 0 8.15 8.15z" />,
  /** A chequered flag: finished. */
  done: (
    <>
      <path d="M5 16.75V3.75h10.5v7H5" />
      <path
        d="M5 3.75h2.625v3.5H5zM10.25 3.75h2.625v3.5H10.25zM7.625 7.25h2.625v3.5H7.625zM12.875 7.25H15.5v3.5h-2.625z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  signals: (
    <>
      <circle cx="10" cy="10" r="1.25" />
      <path d="M6.8 6.8a4.5 4.5 0 0 0 0 6.4M13.2 6.8a4.5 4.5 0 0 1 0 6.4M4.35 4.35a8 8 0 0 0 0 11.3M15.65 4.35a8 8 0 0 1 0 11.3" />
    </>
  ),
  servers: (
    <>
      <rect x="3" y="4" width="14" height="9.5" rx="1.75" />
      <path d="M7.5 16.5h5M10 13.5v3" />
    </>
  ),
  setup: (
    <>
      <path d="M3.5 6.5h7M14.5 6.5h2M3.5 13.5h2M9.5 13.5h7" />
      <circle cx="12.5" cy="6.5" r="2" />
      <circle cx="7.5" cy="13.5" r="2" />
    </>
  ),
  /** A gear: Settings. Drawn on a 24 grid and scaled to the 20 one. */
  settings: (
    <g transform="scale(0.8333)" strokeWidth="1.9">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  document: (
    <>
      <path d="M11.5 3.25H6.25A1.5 1.5 0 0 0 4.75 4.75v10.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M11.5 3.25V7h3.75M7.75 10.5h4.5M7.75 13.25h3" />
    </>
  ),
  code: <path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" />,
  mail: (
    <>
      <rect x="3" y="5" width="14" height="10.5" rx="1.75" />
      <path d="m3.5 6 6.5 5 6.5-5" />
    </>
  ),
  link: (
    <path d="M8.75 11.25a3 3 0 0 0 4.25 0l2.5-2.5a3 3 0 0 0-4.25-4.25l-.75.75M11.25 8.75a3 3 0 0 0-4.25 0l-2.5 2.5a3 3 0 0 0 4.25 4.25l.75-.75" />
  ),
  image: (
    <>
      <rect x="3.25" y="4.25" width="13.5" height="11.5" rx="1.75" />
      <circle cx="7.5" cy="8.25" r="1.25" />
      <path d="m3.75 14 4-3.75 3 2.75 2-1.75 3.5 3" />
    </>
  ),
  table: (
    <>
      <rect x="3.25" y="4.25" width="13.5" height="11.5" rx="1.75" />
      <path d="M3.25 8.25h13.5M3.25 12h13.5M8.25 8.25v7.5" />
    </>
  ),
  /** A pencil on a page: a new task. */
  compose: (
    <>
      <path d="M9.25 4.25h-4a1.5 1.5 0 0 0-1.5 1.5v9a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-4" />
      <path d="M13.75 3.5l2.75 2.75-6.25 6.25H7.5V9.75z" />
    </>
  ),
} as const

export type NavIconName = keyof typeof NAV_ICONS

/** A place in the nav; the nav draws it at 18 points. */
export const NavIcon = ({ name, size = 16 }: { name: NavIconName; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {NAV_ICONS[name]}
  </svg>
)

/** Points right when closed, down when open. */
export const Chevron = ({ open }: { open: boolean }) => (
  <svg
    className={open ? 'chevron open' : 'chevron'}
    width="10"
    height="10"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M6 3.5 10.5 8 6 12.5" />
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

/** Where something stands, in a tone: "Your turn", "Running". */
export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`pill tone-${tone}`}>{children}</span>

/** Three bars, as many lit as the priority is high: urgent all three (in clay), low none. */
export const Bars = ({ priority }: { priority: number }) => (
  <span className={`bars p${priority}`} aria-hidden="true">
    {[1, 2, 3].map((b) => (
      <span key={b} className={b <= 4 - priority ? 'lit' : ''} />
    ))}
  </span>
)

/** A workstream's two-letter mark in its tint, the same wherever the workstream shows. */
export const WorkstreamMark = ({ name }: { name: string }) => {
  const mark = workstreamMark(name)
  return (
    <span className={`ws-mark ${mark.tone}`} aria-hidden="true">
      {mark.letters}
    </span>
  )
}

/** A quiet property: a workstream, a priority. */
export const Tag = ({ children }: { children: ReactNode }) => <span className="tag">{children}</span>

type Who = 'owner' | 'session' | 'watcher' | 'signal' | 'system' | 'scout'

const GLYPH: Partial<Record<Who, ReactNode>> = {
  watcher: (
    <>
      <path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
  owner: (
    <>
      <circle cx="8" cy="5.6" r="2.6" />
      <path d="M3 13.6c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6" />
    </>
  ),
  signal: <path d="M9 1.8 4 9h4l-1 5.2L12 7H8z" />,
}

/** Who did something in a task's timeline: the pilot for Autopilot, Claude for its session, a mark for the rest. */
export const Avatar = ({ who }: { who: Who }) => (
  <span className={`avatar ${who}`} aria-hidden="true">
    {who === 'system' || who === 'scout' ? (
      <Pilot pixel={1} />
    ) : who === 'session' ? (
      <Claude />
    ) : (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {GLYPH[who]}
      </svg>
    )}
  </span>
)

/** A line of news over a screen: something failed, or something worked. */
export const Banner = ({ tone = 'alert', children }: { tone?: Tone; children: ReactNode }) => (
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
  as: Element = 'div',
  className,
  children,
}: {
  top?: Space
  as?: 'div' | 'span' | 'p' | 'ol'
  className?: string
  children: ReactNode
}) => (
  <Element className={className ? `meta ${className}` : 'meta'} style={top === undefined ? undefined : { marginTop: space[top] }}>
    {children}
  </Element>
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
  <div
    role="img"
    aria-label={label}
    style={{ display: 'grid', gridTemplateColumns: `repeat(16, ${pixel}px)`, gridAutoRows: `${pixel}px`, flex: 'none' }}
  >
    {art.rows.flatMap((row, y) =>
      [...row].map((cell, x) => <span key={`${y}-${x}`} style={{ background: art.colours[cell] ?? 'transparent' }} />),
    )}
  </div>
)

/** The pilot, Autopilot's mascot. */
export const Pilot = ({ pixel = 1.5 }: { pixel?: number }) => <Mascot art={pilot} pixel={pixel} label="Autopilot" />

/** Claude, the mark of a session wherever one is shown or opened. */
export const Claude = ({ pixel = 1 }: { pixel?: number }) => <Mascot art={claude} pixel={pixel} label="Claude" />

const Inlines = ({ inlines, onLink }: { inlines: Inline[]; onLink: (url: string) => void }) => (
  <>
    {inlines.map((n, i) => {
      switch (n.kind) {
        case 'text':
          return n.text
        case 'strong':
          return <strong key={i}>{n.text}</strong>
        case 'em':
          return <em key={i}>{n.text}</em>
        case 'code':
          return <code key={i}>{n.text}</code>
        case 'link':
          return (
            <Button key={i} kind="link" className="md-link" onClick={() => onLink(n.url)}>
              {n.text}
            </Button>
          )
      }
    })}
  </>
)

/** Markdown as sessions write it (`parseMarkdown`, shared with the phone), drawn as elements. */
export const Markdown = ({ text, onLink }: { text: string; onLink: (url: string) => void }) => (
  <div className="md">
    {parseMarkdown(text).map((b, i) =>
      b.kind === 'rule' ? (
        <hr key={i} className="md-rule" />
      ) : b.kind === 'heading' ? (
        <div key={i} className={`md-h md-h${b.level}`}>
          <Inlines inlines={b.inlines} onLink={onLink} />
        </div>
      ) : b.kind === 'table' ? (
        // Wide tables scroll sideways inside the message rather than pushing the page out.
        <div key={i} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {b.head.map((cell, c) => (
                  <th key={c} className={`md-${b.align[c] ?? 'left'}`}>
                    <Inlines inlines={cell} onLink={onLink} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={`md-${b.align[c] ?? 'left'}`}>
                      <Inlines inlines={cell} onLink={onLink} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : b.kind === 'list' ? (
        (() => {
          const items = b.items.map((item, j) => (
            <li key={j}>
              <Inlines inlines={item} onLink={onLink} />
            </li>
          ))
          return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>
        })()
      ) : (
        <p key={i}>
          {b.lines.map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              <Inlines inlines={line} onLink={onLink} />
            </span>
          ))}
        </p>
      ),
    )}
  </div>
)
