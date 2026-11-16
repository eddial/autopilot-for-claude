import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Icon } from '../ui.tsx'

/** A choice in a menu; `detail` is lined up in columns beside the labels. */
export type MenuItem = {
  label: string
  detail?: string[]
  /** What it does; a choice with `items` opens them beside it instead. */
  run?: () => void
  /** A submenu, opened beside the choice on hover or click (right-click menus only). */
  items?: MenuItem[]
  /** A choice that is on: ticked at the end. */
  checked?: boolean
  /** What it looks like where it shows: a workstream's mark, a priority's bars. */
  icon?: ReactNode
}

export const Menu = ({
  label,
  className,
  items,
  trigger = 'tool',
  chevron = true,
  align = 'left',
}: {
  label: ReactNode
  className?: string
  items: MenuItem[]
  /** The button that opens it: a toolbar button, or a property row. */
  trigger?: 'tool' | 'prop'
  chevron?: boolean
  align?: 'left' | 'right'
}) => {
  // Where it opens, worked out from its button: floating above the page, so no scrolling column
  // clips it; upwards when there is no room below.
  const [shown, setShown] = useState<{ top: number; left: number | 'auto'; right: number | 'auto' } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shown) return
    const close = () => setShown(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && close()
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', away)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [shown])
  const toggle = () => {
    if (shown) return setShown(null)
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const tall = items.length * 33 + 16
    const top = box.bottom + 6 + tall > window.innerHeight ? Math.max(8, box.top - 6 - tall) : box.bottom + 6
    // One edge set, the other auto: the menu keeps its own width.
    setShown(align === 'right' ? { top, left: 'auto', right: window.innerWidth - box.right } : { top, left: box.left, right: 'auto' })
  }
  return (
    <div className={`menu${trigger === 'prop' ? ' menu-prop' : ''}`} ref={ref}>
      <Button kind={trigger} className={className} aria-haspopup="menu" aria-expanded={shown !== null} onClick={toggle}>
        {label}
        {chevron && <Icon name="more" />}
      </Button>
      {shown &&
        createPortal(
          <div
            ref={list}
            className={`menu-items floating${items.some((i) => i.checked !== undefined) ? ' with-checks' : ''}${items.some((i) => i.icon) ? ' with-icons' : ''}`}
            role="menu"
            // oxlint-disable-next-line react/forbid-dom-props -- placed by its button
            style={shown}
          >
            {items.map((i) => (
              <Button
                key={i.label}
                kind="menu"
                role={i.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={i.checked}
                onClick={() => {
                  setShown(null)
                  i.run?.()
                }}
              >
                {i.icon !== undefined && <span className="menu-icon">{i.icon}</span>}
                {i.label}
                {i.detail?.map((d) => (
                  <span key={d} className="menu-detail">
                    {d}
                  </span>
                ))}
                {i.checked !== undefined && <span className="menu-check">{i.checked && <Icon name="done" />}</span>}
              </Button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** A list's classes: its columns follow what its rows carry. */
const listClass = (items: MenuItem[]) =>
  `${items.some((i) => i.checked !== undefined || i.items) ? ' with-checks' : ''}${items.some((i) => i.icon) ? ' with-icons' : ''}`

/** About how tall a row is, and how wide a menu at most, to keep one inside the window. */
const ROW = 33
const WIDE = 248

/** Where a list of `count` rows opens at (x, y), moved back inside the window. */
const inside = (x: number, y: number, count: number) => ({
  left: Math.max(8, Math.min(x, window.innerWidth - WIDE)),
  top: Math.max(8, Math.min(y, window.innerHeight - count * ROW - 16)),
})

/**
 * The rows of a right-click menu. A choice with `items` opens them beside it when the pointer
 * rests on it or it is clicked, to the right, or to the left where the window ends.
 */
const ContextList = ({ items, at, close }: { items: MenuItem[]; at: { left: number; top: number }; close: () => void }) => {
  const [open, setOpen] = useState<{ index: number; left: number; top: number } | null>(null)
  const show = (index: number, row: HTMLElement) => {
    const sub = items[index]?.items
    if (!sub) return setOpen(null)
    const box = row.getBoundingClientRect()
    const right = box.right + 4 + WIDE <= window.innerWidth
    setOpen({ index, ...inside(right ? box.right + 4 : box.left - 4 - WIDE, box.top - 4, sub.length) })
  }
  const sub = open && items[open.index]?.items
  return (
    <div
      className={`menu-items context${listClass(items)}`}
      role="menu"
      // oxlint-disable-next-line react/forbid-dom-props -- where the pointer was
      style={at}
    >
      {items.map((i, index) => (
        <Button
          key={i.label}
          kind="menu"
          className={open?.index === index ? 'open' : undefined}
          role={i.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={i.checked}
          aria-haspopup={i.items ? 'menu' : undefined}
          aria-expanded={i.items ? open?.index === index : undefined}
          onMouseEnter={(e) => show(index, e.currentTarget)}
          onClick={(e) => {
            if (i.items) return show(index, e.currentTarget)
            close()
            i.run?.()
          }}
        >
          {i.icon !== undefined && <span className="menu-icon">{i.icon}</span>}
          {i.label}
          {i.detail?.map((d) => (
            <span key={d} className="menu-detail">
              {d}
            </span>
          ))}
          {(i.checked !== undefined || i.items) && (
            <span className={`menu-check${i.items ? ' menu-sub' : ''}`}>
              {i.items ? <Icon name="next" /> : i.checked && <Icon name="done" />}
            </span>
          )}
        </Button>
      ))}
      {open && sub && <ContextList items={sub} at={{ left: open.left, top: open.top }} close={close} />}
    </div>
  )
}

/**
 * A right-click menu drawn like every other menu here, rather than the one macOS draws: `open`
 * on contextmenu, and `menu` rendered anywhere (it goes to the end of the page). Choices with
 * `items` open a submenu beside them.
 */
export const useContextMenu = () => {
  const [at, setAt] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close()
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', away)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [at])
  const open = (e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    setAt({ x: e.clientX, y: e.clientY, items })
  }
  const menu =
    at &&
    createPortal(
      <div ref={ref} className="context-root">
        <ContextList items={at.items} at={inside(at.x, at.y, at.items.length)} close={() => setAt(null)} />
      </div>,
      document.body,
    )
  return { open, menu }
}
