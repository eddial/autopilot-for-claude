import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Link } from '@autopilot/contracts'
import { api, shell } from '../api.ts'
import { Button } from '../ui.tsx'

/** A picture on this Mac, which the server can send whole. */
export const isPicture = (url: string) => /^file:.*\.(png|jpe?g|gif|webp)$/i.test(url)

/** Each picture read once a session, however often its update draws. */
const pictures = new Map<string, Promise<string | null>>()
const pictureOf = (taskId: string, url: string): Promise<string | null> => {
  let read = pictures.get(url)
  if (!read) {
    read = api.links.preview({ taskId, url }).then(
      (p) => p.image ?? null,
      () => null,
    )
    pictures.set(url, read)
  }
  return read
}

/**
 * The pictures an update attaches, as thumbnails in place of chips; a click opens one large over
 * the window, and a click or Escape closes it.
 */
export const Shots = ({ taskId, links }: { taskId: string; links: Link[] }) => {
  const [open, setOpen] = useState<Link | null>(null)
  if (links.length === 0) return null
  return (
    <div className="shots">
      {links.map((l) => (
        <Shot key={l.url} taskId={taskId} link={l} onOpen={() => setOpen(l)} />
      ))}
      {open && <Large taskId={taskId} link={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

const usePicture = (taskId: string, url: string) => {
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void pictureOf(taskId, url).then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [taskId, url])
  return src
}

const Shot = ({ taskId, link, onOpen }: { taskId: string; link: Link; onOpen: () => void }) => {
  const src = usePicture(taskId, link.url)
  // Not on this Mac, or too large to send: it opens in its own app instead.
  const fallback = () => shell?.openExternal(link.url)
  return (
    <figure className="shot-figure">
      <Button kind="shot" title={link.title} aria-label={`Open ${link.title}`} onClick={src === null ? fallback : onOpen}>
        {src ? <img src={src} alt="" /> : <span className="shot-empty">{src === null ? 'Open' : ''}</span>}
      </Button>
      <figcaption>{link.title.replace(/^screenshot:\s*/i, '')}</figcaption>
    </figure>
  )
}

const Large = ({ taskId, link, onClose }: { taskId: string; link: Link; onClose: () => void }) => {
  const src = usePicture(taskId, link.url)
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', keys, true)
    return () => window.removeEventListener('keydown', keys, true)
  }, [onClose])
  return createPortal(
    <div className="shot-large" role="dialog" aria-modal="true" aria-label={link.title}>
      <Button kind="backdrop" aria-label="Close the picture" onClick={onClose}>
        {src && <img src={src} alt={link.title} />}
      </Button>
      <div className="shot-large-foot">
        <span>{link.title}</span>
        {shell && (
          <Button kind="quiet" onClick={() => shell?.openExternal(link.url)}>
            Open in Preview
          </Button>
        )}
      </div>
    </div>,
    document.body,
  )
}
