# 5. The Mac is the server; the iPhone reaches it over the LAN or Tailscale

**Decision.** The Mac app installs the server as a launchd agent and talks to it over a Unix
socket. Phones pair with a one-time code and connect over the local network or Tailscale, with TLS
and a key per device. Every caller presents a token, the app included.

**Why.** No server to host, no ports opened to the internet, and free Tailscale covers away from
home. The phone keeps an outbox, so a sleeping Mac only delays things.

**Consequences.** Notifications on the phone need the Mac awake until a push relay exists. An
always-on Mac as server (phase 4) is the answer to that.
