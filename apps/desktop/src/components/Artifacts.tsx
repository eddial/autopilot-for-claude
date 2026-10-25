import { useEffect, useState } from 'react'
import { artifactKind, linkSource } from '@autopilot/client'
import type { ArtifactPreview, Link, QueueItem } from '@autopilot/contracts'
import { api, shell } from '../api.ts'
import { ago } from '../format.ts'
import { Button, Markdown, Meta, NavIcon } from '../ui.tsx'

/**
 * What sessions make (drafts, documents, branches, pull requests) shown as things in their own
 * right: a card each, readable in place when it is a text file on this Mac.
 */

const open = (url: string) => {
  if (shell) shell.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

/** Lines shown before Show all. */
const FOLDED = 12

const Preview = ({ taskId, url }: { taskId: string; url: string }) => {
  const [preview, setPreview] = useState<ArtifactPreview | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    if (!url.startsWith('file:')) return
    void api.links.preview({ taskId, url }).then(setPreview, () => setPreview(null))
  }, [taskId, url])
  if (!preview?.text) return null
  const lines = preview.text.trimEnd().split('\n')
  const folded = !all && lines.length > FOLDED
  return (
    <div className="artifact-preview">
      {/\.(md|markdown)$/i.test(url) ? (
        <Markdown text={folded ? lines.slice(0, FOLDED).join('\n') : preview.text} onLink={open} />
      ) : (
        <pre>{folded ? lines.slice(0, FOLDED).join('\n') : preview.text.trimEnd()}</pre>
      )}
      {(folded || preview.truncated) && (
        <Button kind="link" onClick={() => (folded ? setAll(true) : open(url))}>
          {folded ? `Show all ${lines.length} lines` : 'Open to read the rest'}
        </Button>
      )}
    </div>
  )
}

/** One artifact: what it is, where it lives, and the ways to open it. */
export const ArtifactCard = ({ taskId, link, preview = true }: { taskId: string; link: Link; preview?: boolean }) => {
  const kind = artifactKind(link)
  const file = link.url.startsWith('file:')
  const [copied, setCopied] = useState(false)
  return (
    <div className="artifact">
      <div className="artifact-head">
        <span className="artifact-icon">
          <NavIcon name={kind.icon} size={18} />
        </span>
        <div className="artifact-title">
          {/* Older sessions began titles with where it lives (`file: …`); the card already says. */}
          <span className="name">{link.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')}</span>
          <Meta as="span">{[kind.label, link.subtitle ?? (file ? null : linkSource(link.url))].filter(Boolean).join(' · ')}</Meta>
        </div>
        <div className="artifact-actions">
          <Button kind="tool" onClick={() => open(link.url)}>
            Open
          </Button>
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
      {preview && file && <Preview taskId={taskId} url={link.url} />}
    </div>
  )
}

/** A task's artifacts, newest first, on its page. */
export const TaskArtifacts = ({ taskId, links }: { taskId: string; links: Link[] }) =>
  links.length > 0 ? (
    <section className="section">
      <div className="section-label">Artifacts</div>
      {links.toReversed().map((l) => (
        <ArtifactCard key={l.url} taskId={taskId} link={l} />
      ))}
    </section>
  ) : null

/** Everything sessions have made, across the open tasks and the recently closed ones. */
export const ArtifactsView = ({ items, onOpen }: { items: QueueItem[]; onOpen: (id: string) => void }) => {
  const [closed, setClosed] = useState<QueueItem[]>([])
  useEffect(() => {
    void api.queue.list({ band: 'done' }).then(
      (s) => setClosed(s.items),
      () => {},
    )
  }, [])
  const tasks = [...items, ...closed]
    .filter((i) => i.task.links.length > 0)
    .toSorted((a, b) => Date.parse(b.task.updatedAt) - Date.parse(a.task.updatedAt))
  return (
    <section className="pane task" aria-label="Artifacts">
      <div className="task-head drag" />
      <div className="page">
        <h1 className="serif step-title">Artifacts</h1>
        <p className="lead">What sessions have made for you: drafts, documents, branches and pull requests, newest first.</p>
        {tasks.length === 0 && <Meta>Nothing yet. When a session writes a draft or opens a pull request, it shows here.</Meta>}
        {tasks.map((i) => (
          <div key={i.task.id} className="artifact-group">
            <Button kind="link" className="artifact-task" onClick={() => onOpen(i.task.id)}>
              {i.task.id} · {i.task.title}
            </Button>
            <Meta as="span"> · {ago(i.task.updatedAt)}</Meta>
            {i.task.links.toReversed().map((l) => (
              <ArtifactCard key={l.url} taskId={i.task.id} link={l} preview={false} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
