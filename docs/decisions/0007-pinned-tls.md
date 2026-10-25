# 7. Paired devices pin the Mac's own certificate

**Decision.** The server makes a self-signed certificate once and puts its SHA-256 fingerprint in
the pairing QR code. Devices trust exactly that certificate, whatever the address: on the iPhone
through a small Swift module (`URLSession` with a trust check), in Node through a custom TLS
connector. The listener only lets in loopback, private and Tailscale addresses, and opens with the
first pairing.

**Why.** The Mac is reached by bare IP, by `.local` name and by its Tailscale address, which no
certificate authority will certify, and React Native's `fetch` cannot trust a self-signed
certificate. Pinning gives the same guarantee as a certificate authority for this one server
without one. Tailscale's own HTTPS certificates would cover the tailnet but not the home network.

**Consequences.** The iPhone app needs native code, so it runs as a development build, not in Expo
Go. Replacing the certificate means pairing again. The phone has no streaming connection; it long
polls the change feed instead, which also suits iOS suspending apps.
