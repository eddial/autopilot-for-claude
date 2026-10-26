import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Link } from '@autopilot/contracts'
import { api } from '../api.ts'
import { Button, NavIcon } from '../ui.tsx'

/** A file on its way into a reply: uploading, kept on the Mac, or refused. */
type Sent = { key: string; name: string; link: Link | null; failed: string | null }

const MAX_BYTES = 20 * 1024 * 1024

const base64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result).replace(/^data:[^,]*,/, '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read the file')))
    reader.readAsDataURL(file)
  })

/**
 * Files pasted or dropped into a reply. Each uploads as soon as it arrives, kept with the task on
 * the Mac, and shows as a chip until the reply is sent; `links` is what has landed.
 */
export const useFiles = (taskId: string) => {
  const [files, setFiles] = useState<Sent[]>([])
  const add = (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const key = crypto.randomUUID()
      const name = file.name || `Pasted ${file.type.split('/')[1] ?? 'file'}`
      setFiles((all) => [...all, { key, name, link: null, failed: file.size > MAX_BYTES ? 'Over 20 MB' : null }])
      if (file.size > MAX_BYTES) continue
      void base64(file)
        .then((data) => api.files.upload({ idempotencyKey: key, taskId, name, type: file.type, data }))
        .then(
          (link) => setFiles((all) => all.map((f) => (f.key === key ? { ...f, link } : f))),
          (error: unknown) =>
            setFiles((all) =>
              all.map((f) => (f.key === key ? { ...f, failed: error instanceof Error ? error.message : 'Could not send it' } : f)),
            ),
        )
    }
  }
  const links = files.flatMap((f) => (f.link ? [f.link] : []))
  return {
    files,
    links,
    add,
    /** Still uploading: sending waits for these. */
    busy: files.some((f) => !f.link && !f.failed),
    remove: (key: string) => setFiles((all) => all.filter((f) => f.key !== key)),
    clear: () => setFiles([]),
    /** For a text box: files in the clipboard come in as files; text pastes as usual. */
    onPaste: (e: ClipboardEvent) => {
      if (e.clipboardData.files.length === 0) return
      e.preventDefault()
      add(e.clipboardData.files)
    },
    /** For the box around it: files dropped from Finder or anywhere else. */
    drop: {
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      },
      onDrop: (e: DragEvent) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        add(e.dataTransfer.files)
      },
    },
  }
}

/** The files in a reply before it is sent, each with a way to take it out again. */
export const FileChips = ({ files, onRemove }: { files: Sent[]; onRemove: (key: string) => void }) =>
  files.length > 0 ? (
    <div className="file-chips">
      {files.map((f) => (
        <span key={f.key} className={`file-chip${f.failed ? ' failed' : f.link ? '' : ' uploading'}`} title={f.failed ?? f.name}>
          <NavIcon name="document" size={13} />
          <span className="file-chip-name">{f.name}</span>
          <span className="file-chip-meta">{f.failed ?? (f.link ? f.link.subtitle : 'Adding…')}</span>
          <Button kind="quiet" className="file-chip-remove" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.key)}>
            ×
          </Button>
        </span>
      ))}
    </div>
  ) : null

/** The paperclip in a reply: picks files from the Mac to send with it (pasting and dropping work too). */
export const AttachButton = ({ onFiles }: { onFiles: (files: FileList) => void }) => {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <Button
        kind="icon"
        className="attach"
        aria-label="Attach files"
        title="Attach files (or paste or drop them)"
        onClick={() => input.current?.click()}
      >
        <NavIcon name="attach" size={16} />
      </Button>
    </>
  )
}
