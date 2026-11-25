# Run the BRB app on your iPhone (free)

No paid Apple developer account is needed. The app only uses modules that ship inside Expo Go.

## One time
1. On the Mac: Tailscale installed and signed in. On the iPhone: Tailscale and Expo Go from the App Store, signed in to the same tailnet.
2. On the Mac: `cd brb/relay && swift run brb-relay serve` (or `scripts/install-launchd.sh` to start it at login).
3. On the Mac: `cd brb/app && npm install && npx expo start`. Scan the QR code with the iPhone camera; it opens in Expo Go. The phone must reach the Mac for this, over the same Wi-Fi or with `npx expo start --tunnel`.

## Pair
1. On the Mac: `brb-relay pair` (read-only) or `brb-relay pair --control` (can type into terminals).
2. In the app: enter the Mac's Tailscale address (`tailscale ip -4`, or the MagicDNS name) and the code.

## Notifications when the app is closed
1. On the Mac: `brb-relay push setup`.
2. Install the free ntfy app on the iPhone.
3. In BRB: Settings, Notifications, Open in ntfy. Test with `brb-relay push test` on the Mac.

By default alerts only say that an agent needs attention. `brb-relay push setup --include-text` sends the real text, which the ntfy server and Apple's push service would then see.

## Keeping it running without the Mac's dev server
Expo Go needs `expo start` running. For a standalone app later: `eas build` needs an Apple developer account for iPhone; Android builds (an APK) are free.
