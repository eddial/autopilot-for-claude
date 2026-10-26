import { pilot } from '@autopilot/design'

/**
 * The pilot as a menu bar template: its shape in black at 2x, the hat band, badge and glasses cut
 * out so it still reads as the pilot. macOS draws it white or dark to match the bar, like every
 * other icon there.
 */
export const pilotTemplate = (): Buffer => {
  const scale = 2
  const size = 16 * scale
  const solid = new Set(['B', 'N', 'V'])
  const buffer = Buffer.alloc(size * size * 4)
  const top = Math.floor((16 - pilot.rows.length) / 2)
  pilot.rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      if (!solid.has(row.charAt(x))) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const offset = (((top + y) * scale + dy) * size + x * scale + dx) * 4
          buffer[offset + 3] = 255
        }
      }
    }
  })
  return buffer
}
