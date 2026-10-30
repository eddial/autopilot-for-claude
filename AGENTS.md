# What the owner keeps correcting

Rules for any agent changing the apps, learnt from one long session in October 2026 in which the
owner had to correct the phone and Mac UI about thirty times. Each was a fix someone had to ask
for; most were the same few mistakes again. Read this before any UI change, and check your work
against it before calling it done. How to build and test the phone is in
`.claude/skills/building-for-the-duo/SKILL.md`; the design rules are in `docs/DESIGN.md`.

## Buttons go in bars, never on the content

- A button never floats over the page, the list or a pane. It goes in a native bar
  (`Stack.Toolbar`), in that bar's ⋯ menu, or in a menu behind another button.
- If a pose has no room in its bar, fold actions into one menu (as the status button holds Mark
  done, Snooze and Not for me) rather than adding a row, a floating button or a second bar.
- Where the bar is see-through and runs across the top (the Duo open upright), the content
  starts below it. Nothing scrolls under the buttons.
- Never give a button a row of its own at the foot of a list or beside the composer: that row is
  the content's.
- Two ⋯ in one bar means the bar is too long and iOS folded it. Take a button out.
- Prefer a gesture the system already has over a button: a tap on the title goes to the top, a
  swipe closes a task.

## Every pose, every time

- The Duo has six poses (folded and open, portrait and landscape, split view left and right). A
  change made for one pose has broken another again and again: search went back to the top bar,
  the close button disappeared, a button landed on the list.
- After any change to a bar, a header or a layout, take a screenshot of each pose and look at
  it: nothing under a bar, no truncated text, nothing doubled, the same margins.
- Keep what worked. Before removing or moving something, check every way it was reached still
  works (closing a task, search, back to the top).

## Room is for content

- No empty headroom above a list or a page, and no strip of unused space at the bottom. When
  something leaves, the content takes its place.
- A large search bar, a title that sticks, a black band above the tabs: each was a complaint.
  Search is a button that opens into a field, where the bar has room for it.
- No search while a task is open.

## Motion is plain and instant

- Slides, not effects. A list or a task moves in one direction with the finger and lands;
  nothing fades, scales or bounces.
- No flash of the old state: not the top of a page before it jumps to its end, not the last task
  before the next, not an empty composer before it is sized. The first frame must already be
  right.
- Animate on the native driver. A transition below 60 frames a second was a complaint.
- Check the direction of a gesture against what the owner described, not against what seemed
  natural.

## State follows the device

- Folding or unfolding keeps the task you were on, and opens it in the layout the new pose
  uses. A notification opens the task where the current layout shows tasks, on its tab.
- The keyboard goes away after sending.

## Icons say what tapping does

- An icon for an action shows the action or the status it changes, consistently across tasks,
  not an incidental state (the "Needs me" hand on the status button was wrong; the status is a
  ringed dot in the band's colour).
- When unsure, show two or three options as screenshots on the device and let the owner pick.

## Finish the job

- Look at the result on the simulator or in the window before saying it is done. Truncation,
  doubled labels and misaligned corners were all visible in a screenshot.
- Never push when `pnpm check` failed: test its exit code before `git push`, never chain them.
- Never restart the server or reinstall the Mac app by hand: pushing to main ships them (and the
  iPhone app) through the `autopilot.ship` agent (`docs/SHIPPING.md`). Check its log before saying
  a change is live.
