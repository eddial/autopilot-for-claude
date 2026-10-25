/** Five fields, `m h dom mon dow`, in local time; each a list of `*`, `n` or `a-b`, with an optional `/step`. */
export const cronMatches = (expression: string, at: Date): boolean => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`Not a cron expression: ${expression}`)
  const values = [at.getMinutes(), at.getHours(), at.getDate(), at.getMonth() + 1, at.getDay()]
  return fields.every((field, i) => {
    const value = values[i] ?? -1
    return field.split(',').some((part) => {
      const [range = '*', step] = part.split('/')
      const [lo, hi] = range === '*' ? [0, 99] : range.split('-').map(Number)
      const low = lo ?? 0
      const high = hi ?? (step || range === '*' ? 99 : low)
      return value >= low && value <= high && (value - low) % Number(step ?? 1) === 0
    })
  })
}

/** The latest matching minute in the last eight days, so a run missed while the Mac slept runs on wake. */
export const lastCronMatch = (expression: string, now: Date): Date | null => {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000
  for (let i = 0; i < 8 * 1440; i++) {
    const at = new Date(minute - i * 60_000)
    if (cronMatches(expression, at)) return at
  }
  return null
}
