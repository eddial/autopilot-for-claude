# 4. Electron on the Mac, Expo on the iPhone

**Decision.** The Mac app is Electron with React, styled like Claude. The iPhone app is Expo
(React Native), distributed through TestFlight.

**Why.** Claude desktop made the same desktop choice; Expo runs well enough on iPhone Duo and shares the contract and client logic. The two apps do not share screens.

**Consequences.** On iPhone Duo the app must use the native stack header and native tabs so iOS can
move them into the vertical bar; hand-built bars do not move.
