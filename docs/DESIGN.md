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

## What the colours mean

Pilot green is Autopilot's own colour and leads; Claude's clay marks Claude at work. That keeps
Autopilot recognisably itself beside Claude.

| Colour | Tone | Means |
| --- | --- | --- |
| Pilot green | `pilot` | What needs you, the next step (primary buttons, send), healthy, new from a signal |
| Clay (Claude orange) | `claude` | A Claude session at work: running tasks, Open session, the session's avatar |
| Amber | `paused` | Waiting on something: others, a time, a watcher |
| Warm red | `alert` | Something failed or was refused |
| White / grey | `quiet` | You, and everything neutral |

The pilot is Claude's pixel mascot in pilot green, with aviators and a cap whose badge is Claude's
clay. In a task's timeline the session appears as Claude's own mascot in clay, Autopilot as the
pilot.

## Building blocks

| | Mac window (`apps/desktop/src/ui.tsx`) | iPhone (`apps/mobile/src/ui.tsx`) |
| --- | --- | --- |
| Buttons | `Button` with a `kind`: primary, secondary, tool, quiet, link, chip, icon, send, tab, section, step, row, item, menu | `Button` (primary, secondary, option, destructive), `Chip` |
| Status | `Dot`, `Banner`, `Pill`, by tone; `Tag` for properties | `Dot`, `Banner`, `Pill`, by tone; `Tag` for properties |
| Who | `Avatar`: the pilot for Autopilot, Claude for the session, an eye for a watcher, a bolt for a signal, you | `Avatar`, with SF Symbols |
| Text | `Meta`; headings are `h1.serif`; section labels are small capitals (`.section-label`) | `type.title`, `heading`, `body`, `name`, `lead`, `meta`, `note`, `label` |
| Layout | `Row`, `Column`, `Spacer` (spacing steps only) | `Card`, `CardHead` |
| Mascot | `Pilot` | `Pilot` |

The kinds are the same on both, so a primary action looks and reads as one everywhere.

In the window, lint refuses a raw `<button>` or a `style` prop outside `ui.tsx`. Something new
becomes a kind or a class in `styles.css`, not a one-off. A measured position (the virtual list, the
dragged width) is the only exception, marked with a disable comment that says why.

The phone draws native bars and tabs with the system's own controls (they are what the iPhone Duo
moves); the building blocks are for what is inside them.

## The list, the same on both

The Mac's left column and the phone's queue are one design. When one changes, the other changes
in the same commit, looked at in the Mac window and in the simulator before it lands.

From the top:

1. **Status tabs**, one row of five, each an icon and a count. The tab you are on also says its
   name. Tapping it again shows every open task ("All open"), and once more goes back.

   | Tab               | Mac (`NavIcon`) | iPhone (SF Symbol) |
   | ----------------- | --------------- | ------------------ |
   | Needs me          | `inbox` (tray)  | `tray`             |
   | Running           | `running`       | `rays`             |
   | Waiting on others | `waiting`       | `clock`            |
   | Snoozed           | `snoozed`       | `moon`             |
   | Done              | `done`          | `flag.checkered`   |

2. **Search**, with tokens (`ws:engineering from:slack`), and New task beside it.
3. **Sections**, one per workstream: its badge (`workstreamMark` in `@autopilot/client`: two
   letters and a tint, the same for a name everywhere) and its name. Ordered by the most pressing
   task in each, the inbox last. A section folds away and then shows its count.
4. **Cards**: title, then the update label and the source (the workstream is the section), age on
   the right, the status dot on the left.
5. **Places**: Settings, on the Mac only (a floating dialog from the gear). The phone has one
   screen, the queue; its Mac (how it is reached, unpair) is a menu beside New task.

What is the platform's, not ours: the Mac's window buttons above the tabs and the resizable width;
the phone's safe areas.

## The iPhone on the Duo

Built to Apple's [Design for iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111466/)
and [Prepare your app for iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111461/):

- **Native bars only.** Actions are `Stack.Toolbar` items, so iOS moves them into the vertical bar on
  the outer display and in landscape, and to the outer edge in split view (the left edge when the app
  is on the left). Top items go to the top of the bar, bottom items to the bottom; nothing custom
  floats where the bar goes.
- **Two lines, one gutter.** A screen's title is centred on the line of the camera and the bar's
  first button, its bottom bar (the tabs, the composer's send) on the line of the bar's last button
  (`EDGE`, `edgeSpace` in `src/ui.tsx`). Every screen starts and ends on `GUTTER`. Sides come from the
  safe area measured per screen (`Sides`), never a fixed width, so the bar's side and split view need
  no special case.
- **Size classes, not devices.** Compact width is one column; regular width (`SPLIT_WIDTH`) is list
  and task side by side, the same hierarchy, so opening and closing the phone changes nothing else.
- **The keyboard.** The composer sits just above it, measured where the screen is (`KeyboardScreen`),
  as Claude's own composer does; with it down, the send lines up with the bar's last button.

Test every change folded and open, portrait and landscape, split view left and right, keyboard up
and down. The simulator folds with a hinge event (see `docs/RUNNING.md`).
