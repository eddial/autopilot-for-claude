import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Icon } from '../ui.tsx'

/** A choice in a menu; `detail` is lined up in columns beside the labels. */
export type MenuItem = {
  label: string
  detail?: string[]
  run: () => void
  /** A choice that is on: ticked at the start. */
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
  const [shown, setShown] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shown) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setShown(false)
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setShown(false)
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', away)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', away)
    }
  }, [shown])
  return (
    <div className={`menu${trigger === 'prop' ? ' menu-prop' : ''}`} ref={ref}>
      <Button kind={trigger} className={className} aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        {label}
        {chevron && <Icon name="more" />}
      </Button>
      {shown && (
        <div
          className={`menu-items${align === 'right' ? ' align-right' : ''}${items.some((i) => i.checked !== undefined) ? ' with-checks' : ''}${items.some((i) => i.icon) ? ' with-icons' : ''}`}
          role="menu"
        >
          {items.map((i) => (
            <Button
              key={i.label}
              kind="menu"
              role={i.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={i.checked}
              onClick={() => {
                setShown(false)
                i.run()
              }}
            >
              {i.checked !== undefined && <span className="menu-check">{i.checked && <Icon name="done" />}</span>}
              {i.icon !== undefined && <span className="menu-icon">{i.icon}</span>}
              {i.label}
              {i.detail?.map((d) => (
                <span key={d} className="menu-detail">
                  {d}
                </span>
              ))}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
