/**
 * Markdown as sessions write it, parsed once for both apps: headings, lists, paragraphs, and
 * bold, italics, code and links within a line. Each app draws the result with its own elements,
 * never as HTML, so nothing in a message can run.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'rule' }

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g
const ITEM = /^\s*([-*•]|\d+[.)])\s+/
const HEADING = /^(#{1,3})\s+(.*)$/
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

export const parseInline = (text: string): Inline[] => {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    if (m[2] ?? m[3]) out.push({ kind: 'strong', text: m[2] ?? m[3] ?? '' })
    else if (m[4]) out.push({ kind: 'code', text: m[4] })
    else if (m[5] && m[6]) out.push({ kind: 'link', text: m[5], url: m[6] })
    else out.push({ kind: 'em', text: m[7] ?? m[8] ?? '' })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

export const parseMarkdown = (text: string): Block[] => {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const heading = HEADING.exec(line)
    if (line.trim() === '') {
      i++
    } else if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
    } else if (heading) {
      blocks.push({ kind: 'heading', level: Math.min(3, heading[1]?.length ?? 1) as 1 | 2 | 3, inlines: parseInline(heading[2] ?? '') })
      i++
    } else if (ITEM.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: Inline[][] = []
      while (i < lines.length && ITEM.test(lines[i] ?? '')) {
        items.push(parseInline((lines[i] ?? '').replace(ITEM, '')))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
    } else {
      const para: Inline[][] = []
      const plain = (l: string) => l.trim() !== '' && !HEADING.test(l) && !ITEM.test(l) && !RULE.test(l)
      while (i < lines.length && plain(lines[i] ?? '')) {
        para.push(parseInline(lines[i] ?? ''))
        i++
      }
      blocks.push({ kind: 'paragraph', lines: para })
    }
  }
  return blocks
}
