/**
 * A task's title until Autopilot names it: the brief's first line, cut at a word to fit. Shared so
 * the phone shows the same title for a task it created offline as the Mac gives it.
 */
export const titleFromBrief = (brief: string): string => {
  const line =
    brief
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
      .find((l) => l.length > 0) ?? ''
  if (line.length <= 80) return line || 'New task'
  const cut = line.slice(0, 80)
  const space = cut.lastIndexOf(' ')
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`
}
