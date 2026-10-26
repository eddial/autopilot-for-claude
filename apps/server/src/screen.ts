// Both ship as bundles Node can only load whole: their names come off the default export.
// oxlint-disable-next-line import/default
import serialize from '@xterm/addon-serialize'
import headless from '@xterm/headless'

/**
 * A session's screen as a terminal draws it. Claude Code redraws only what changed, so its raw
 * output skips characters already on screen (a link can arrive as two pieces with a jump between);
 * reading what a terminal would show is the only reliable way to read it.
 */
export class Screen {
  private readonly term: InstanceType<typeof headless.Terminal>
  // oxlint-disable-next-line import/no-named-as-default-member
  private readonly saver = new serialize.SerializeAddon()

  constructor(cols = 120, rows = 40) {
    this.term = new headless.Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true })
    this.term.loadAddon(this.saver)
  }

  /** Draws `data`; `then` runs once it is on the screen. */
  write(data: string, then?: () => void): void {
    this.term.write(data, then)
  }

  /** The screen and what scrolled off it, as text, a wrapped line joined to the one it continues. */
  text(): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
      else lines.push(text)
    }
    return lines.join('\n')
  }

  /** The screen as what draws it again, for a server that reattaches after a restart. */
  serialize(): string {
    return this.saver.serialize({ scrollback: 2000 })
  }

  dispose(): void {
    this.term.dispose()
  }
}
