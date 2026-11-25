# Transport: plain HTTP over Tailscale, and TLS later (S5 spike)

Decision for now: the app talks plain `http://` and `ws://` to the relay on its Tailscale address. Tailscale already encrypts and authenticates that path with WireGuard, and the relay only listens on the Tailscale interface.

What the app needs for this:
- iOS: App Transport Security allows it through `NSAllowsArbitraryLoads` in `app.json` (Expo Go allows it already).
- Android: cleartext traffic enabled through `expo-build-properties`.

Why this is acceptable: nothing on the open internet or the local Wi-Fi can read it; only devices on your tailnet can reach the relay, and each needs a pairing code and its own token.

Weaker spots: a device on your tailnet that is not yours (shared nodes) could connect and try codes (lockouts apply), and the app's `NSAllowsArbitraryLoads` is broad.

TLS later: the app already switches to `wss://` when the address starts with `https://`. `tailscale serve --https=443 http://127.0.0.1:4399` on the Mac gives a trusted certificate for the Mac's `*.ts.net` name; point the app at that name and remove the cleartext exceptions. This has not been tried yet.
