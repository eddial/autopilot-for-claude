import { useEffect, useState } from 'react'
import { linkKind, linkSource } from '@autopilot/client'
import type { LinkPreview, Link } from '@autopilot/contracts'
import { api, shell } from '../api.ts'
import { Button, Chevron, Markdown, Meta, NavIcon } from '../ui.tsx'

/**
 * What a task points to: drafts, files, branches, pull requests. One quiet line until opened;
 * then each link says what kind of thing it is, opens the right way, and a text file reads in place.
 */

const open = (url: string) => {
  if (shell) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

/** Files the server can show the start of. */
const READABLE = /^file:.*\.(md|markdown|txt|csv|json|ya?ml|html?|eml|ts|tsx|js|py|sql)$/i

/** Lines shown before Show all. */
const FOLDED = 12

/** Older sessions began titles with where it lives (`file: …`); the row already says. */
/** The file's name, from a file: link. */
const fileName = (url: string) =>
  decodeURI(url.replace(/^file:\/\//, ''))
    .split('/')
    .pop() ?? url

const titleOf = (link: Link) => link.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')

const Preview = ({ taskId, url }: { taskId: string; url: string }) => {
  const [preview, setPreview] = useState<LinkPreview | null | 'none'>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    void api.links.preview({ taskId, url }).then(
      (p) => setPreview(p.text === null ? 'none' : p),
      () => setPreview('none'),
    )
  }, [taskId, url])
  if (preview === null) return <Meta className="link-preview">Reading…</Meta>
  if (preview === 'none' || preview.text === null) return <Meta className="link-preview">Nothing to show here; open it instead.</Meta>
  const lines = preview.text.trimEnd().split('\n')
  const folded = !all && lines.length > FOLDED
  const text = folded ? lines.slice(0, FOLDED).join('\n') : preview.text.trimEnd()
  return (
    <div className="link-preview">
      {/\.(md|markdown)$/i.test(url) ? <Markdown text={text} onLink={open} /> : <pre>{text}</pre>}
      {(folded || preview.truncated) && (
        <Button kind="link" onClick={() => (folded ? setAll(true) : open(url))}>
          {folded ? `Show all ${lines.length} lines` : 'Open to read the rest'}
        </Button>
      )}
    </div>
  )
}

/** One link: its kind, where it lives, and the ways to open it. */
export const LinkRow = ({ taskId, link }: { taskId: string; link: Link }) => {
  const kind = linkKind(link)
  const file = link.url.startsWith('file:')
  const [reading, setReading] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <li className="link-row">
      <div className="link-head">
        <span className="link-icon">
          <NavIcon name={kind.icon} size={16} />
        </span>
        <Button kind="item" className="link-title" onClick={() => open(link.url)}>
          <span className="title">{titleOf(link)}</span>
          <span className="meta">
            {[file ? fileName(link.url) : kind.label, link.subtitle ?? (file ? null : linkSource(link.url))].filter(Boolean).join(' · ')}
          </span>
        </Button>
        <div className="link-actions">
          {READABLE.test(link.url) && (
            <Button kind="quiet" aria-expanded={reading} onClick={() => setReading((r) => !r)}>
              <Chevron open={reading} />
              Read
            </Button>
          )}
          {file && shell && (
            <Button kind="quiet" onClick={() => shell?.reveal(link.url)}>
              Show in Finder
            </Button>
          )}
          <Button
            kind="quiet"
            onClick={() => {
              void navigator.clipboard
                .writeText(file ? decodeURI(link.url.replace(/^file:\/\//, '')) : link.url)
                .then(() => setCopied(true))
            }}
          >
            {copied ? 'Copied' : file ? 'Copy path' : 'Copy link'}
          </Button>
        </div>
      </div>
      {reading && <Preview taskId={taskId} url={link.url} />}
    </li>
  )
}

/** The task's links: one quiet line naming their kinds, the rows once opened. */
export const Linked = ({ taskId, links }: { taskId: string; links: Link[] }) => {
  const [shown, setShown] = useState(false)
  if (links.length === 0) return null
  const kinds = [...new Set(links.map((l) => linkKind(l).label))]
  return (
    <section className="linked">
      <Button kind="link" className="linked-toggle" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        <Chevron open={shown} />
        {links.length} linked · {kinds.join(', ')}
      </Button>
      {shown && (
        <ul>
          {links.toReversed().map((l) => (
            <LinkRow key={l.url} taskId={taskId} link={l} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** The kind's icon on an update's attachment chip. */
export const LinkIcon = ({ link }: { link: Link }) => <NavIcon name={linkKind(link).icon} size={13} />
