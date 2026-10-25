import { PILOT_COLOURS, PILOT_ROWS } from '../src/pilot.ts'

/** The pilot as a 16×16 BGRA bitmap for the menu bar, centred vertically. */
export const pilotBitmap = (): Buffer => {
  const size = 16
  const buffer = Buffer.alloc(size * size * 4)
  const top = Math.floor((size - PILOT_ROWS.length) / 2)
  PILOT_ROWS.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      const colour = PILOT_COLOURS[row.charAt(x)]
      if (!colour) continue
      const offset = ((top + y) * size + x) * 4
      buffer[offset] = Number.parseInt(colour.slice(5, 7), 16)
      buffer[offset + 1] = Number.parseInt(colour.slice(3, 5), 16)
      buffer[offset + 2] = Number.parseInt(colour.slice(1, 3), 16)
      buffer[offset + 3] = 255
    }
  })
  return buffer
}
