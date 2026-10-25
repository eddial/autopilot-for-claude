import { PILOT_COLOURS, PILOT_ROWS } from '../pilot.ts'

export const Pilot = ({ pixel = 1.5 }: { pixel?: number }) => (
  <div
    role="img"
    aria-label="Autopilot"
    style={{ display: 'grid', gridTemplateColumns: `repeat(16, ${pixel}px)`, gridAutoRows: `${pixel}px`, flex: 'none' }}
  >
    {PILOT_ROWS.flatMap((row, y) =>
      [...row].map((cell, x) => <span key={`${y}-${x}`} style={{ background: PILOT_COLOURS[cell] ?? 'transparent' }} />),
    )}
  </div>
)
