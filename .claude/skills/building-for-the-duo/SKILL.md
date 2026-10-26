---
name: building-for-the-duo
description: How to build, lay out and test the Autopilot iPhone app (apps/mobile) for the iPhone Duo foldable - the vertical bar, folded and open, portrait and landscape, split view left and right, the keyboard. Use for any change to a phone screen, its bars, its composer or its layout, and before calling phone UI work done.
---

# Building for the iPhone Duo

The phone app is mostly used on an iPhone Duo. Everything below was learnt the hard way; follow
it, and test every pose before saying a screen is done. The rules themselves are in
`docs/DESIGN.md` ("Shapes", "The iPhone on the Duo"); this is how to work with them.

## The device, in short

- **Folded (outer display)**: wider than tall. iOS moves the nav bar, toolbars, the back button and
  the status bar into a **vertical bar on the right edge**: top items at its top, bottom items at
  its bottom. ~466x678 points portrait, 678x466 landscape (bar on the left then).
- **Open (inner display)**: ~951x669 landscape, 669x951 portrait. Landscape keeps the vertical bar;
  **portrait lays bars horizontally across the top and bottom** like a normal iPhone.
- **Split view** (inner, landscape only): two apps, 50/50. The app's bar sits on its **outer edge**:
  the left edge when the app is on the left, the right edge when it is on the right.
- **Short screens drop toolbar items into an overflow (⋯)** by themselves. Keep the bar short:
  `TaskToolbar` hides back-to-top when the height is under 500 so the arrows keep their place.

## Layout rules (all in `apps/mobile/src/ui.tsx`)

- **Only native bars.** Actions are `Stack.Toolbar` items (`placement` right/left/bottom),
  search is `Stack.SearchBar` + `Stack.Toolbar.SearchBarSlot`. Never draw a custom bar where the
  system bar goes. Toolbar items must be **direct children** of `Stack.Toolbar`: fragments and
  wrapper components are ignored; render each item with `hidden` instead of conditionally.
- **Sides come from the safe area, measured per screen**: wrap a screen in `Sides`, which has its
  own `SafeAreaProvider`. The root provider never sees the bar iOS puts inside the window in split
  view. In the split layout give the list `edges={['left']}` and the task `edges={['right']}`.
- **One gutter**: `GUTTER` (16) left and right on every screen, for titles, rows, tabs and composer.
- **Two lines**: a screen's title is centred on the camera's line, its last row (tabs, composer
  send) on the bar's last button: `EDGE`, `edgeSpace(height)`. At the bottom use
  `useBottomGap(height)` (read inside `Sides` or `KeyboardScreen`): it centres on the edge line
  beside a vertical bar and sits above iOS's horizontal bar in open portrait (bottom inset > 40).
  Under a solid header, subtract `useHeaderHeight()` (from `expo-router/react-navigation`) from the
  title's top space.
- **Header options merge.** When switching between layouts, set every key the other layout set
  (`headerTransparent`, `headerStyle`, `scrollEdgeEffects`), or the old one sticks after rotating.
- **The keyboard**: put a composer screen in `KeyboardScreen`. It measures how far the keyboard
  reaches into the screen with `measureInWindow`, so a sheet, a pushed screen and a split half all
  get the composer 12 points above the keys. `KeyboardAvoidingView` with a fixed offset got this
  wrong (the reply box slid under the keyboard).
- **Shapes and colours** come from `@autopilot/design`: `shaped('row' | 'button' | 'card' | ...)`,
  `colours.*`. The Mac's look leads; a test fails if a shared block is shaped by hand. The phone's
  own exceptions (darker ground, Claude-style composer, SF Symbols) are listed in DESIGN.md.
- **Compare with Claude's iPhone app** for the composer and the dark ground: its ground is about
  `#1B1B1B`, ours is the `well` token.

## Testing every pose

Build and run in the Duo simulator (`4275DFCA-...` is "iPhone Duo"):

```sh
cd apps/mobile/ios && LANG=en_US.UTF-8 xcodebuild -workspace Autopilot.xcworkspace -scheme Autopilot \
  -configuration Release -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone Duo' \
  -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build
xcrun simctl install booted build/Build/Products/Release-iphonesimulator/Autopilot.app
```

(`pod install` needs `LANG=en_US.UTF-8`; `npx expo export --platform ios` checks Hermes bundling.)

- **Fold and turn**: `simctl` has no fold command. `apps/mobile/scripts/duo.sh outer|inner
  [portrait|landscape-left|landscape-right]` sends Device Hub's hinge event. Orientation sometimes
  does not stick; the simulator tool's `rotate` always does.
- **Split view**: long-press the app on the inner Home Screen, then Open in Split View. That puts
  the app on the **left**. For the **right**: open Split View from Safari (long-press it in the dock),
  then tap Autopilot on the Home Screen half.
- **Keyboard**: the simulator hides the on-screen keyboard (hardware keyboard). Use the simulator
  tool's `set_keyboard show`, then focus a field.
- **Pair a simulator with the running server** for real data, and unpair it afterwards:
  `xcrun simctl openurl booted "$(pnpm -s autopilot devices pair --link)"`, then
  `pnpm autopilot devices` and `pnpm autopilot devices remove <id>` (the simulator is "iPhone Duo").
- **Screenshots lag a beat** behind taps: take a second one before judging.
- **Coordinates are points of the lit screen**: outer 466x678, inner 951x669 (landscape).

The sweep, every time a phone screen changes:

| Pose | Keyboard |
| --- | --- |
| Folded, portrait | up and down |
| Folded, landscape | up and down |
| Open, portrait | up and down |
| Open, landscape (list and task side by side) | up and down |
| Split view, app left | up and down |
| Split view, app right | up and down |

In each: the title level with the camera / first bar button, the last row level with the last bar
button (or above a horizontal bar), nothing under a bar, the same 16-point margins on both panes,
and the composer just above the keyboard.

## Shipping to the device

```sh
xcodebuild ... -configuration Release -destination 'id=<device udid>' -derivedDataPath build-device \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<team> CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device <udid> build-device/Build/Products/Release-iphoneos/Autopilot.app
```

A free personal team cannot sign push: empty `ios/Autopilot/Autopilot.entitlements` to `<dict/>`
for local builds. The first launch needs the developer trusted on the phone (Settings, General,
VPN & Device Management).
