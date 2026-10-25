# Design system

Small on purpose: one set of tokens, a handful of building blocks per app, and checks that keep
screens to them. The look itself is in `PRODUCT.md`.

## Tokens

`packages/design/src/tokens.ts` holds every colour, font, radius and spacing step, the three tones
(attention, good, quiet) and the pilot's pixels. Nothing else names a colour.

- The Mac window reads them as CSS variables from `apps/desktop/src/tokens.css`, generated with
  `pnpm tokens`. Never edit that file.
- The phone and the Electron main process import them.
- A test fails when `tokens.css` is stale or when a colour literal (`#…`, `rgb(…)`) appears in
  either app's sources. Need a new colour? Add it to the tokens, with a name for what it means.

## Building blocks

| | Mac window (`apps/desktop/src/ui.tsx`) | iPhone (`apps/mobile/src/ui.tsx`) |
| --- | --- | --- |
| Buttons | `Button` with a `kind`: primary, secondary, tool, quiet, link, chip, icon, send, nav, row, menu | `Button` (primary, secondary, option, destructive), `Chip` |
| Status | `Dot`, `Banner`, `Pill`, by tone; `Tag` for properties | `Dot`, `Banner`, `Pill`, by tone; `Tag` for properties |
| Who | `Avatar`: the pilot for Autopilot, a spark for the session, an eye for a watcher, you | `Avatar`, with SF Symbols |
| Text | `Meta`; headings are `h1.serif`; section labels are small capitals (`.section-label`) | `type.title`, `heading`, `body`, `name`, `lead`, `meta`, `note`, `label` |
| Layout | `Row`, `Column`, `Spacer` (spacing steps only) | `Card`, `CardHead` |
| Mascot | `Pilot` | `Pilot` |

The kinds are the same on both, so a primary action looks and reads as one everywhere.

In the window, lint refuses a raw `<button>` or a `style` prop outside `ui.tsx`. Something new
becomes a kind or a class in `styles.css`, not a one-off. A measured position (the virtual list, the
dragged width) is the only exception, marked with a disable comment that says why.

The phone draws native bars and tabs with the system's own controls (they are what the iPhone Duo
moves); the building blocks are for what is inside them.
