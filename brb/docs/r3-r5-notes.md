# R3 to R5 notes

Status: written and checked with a type check, 32 protocol tests against a fake relay, 3 app-logic tests, and an iOS bundle build. **Never run on a phone or against the real relay.** Expect first-run problems.

## What exists
- R3 `protocol/`: the client library.
- R4 `app/`: pairing, workspace and terminal lists, a live terminal with colors and cursor, settings, unpair.
- R5: typing and quick keys, snippets from the relay, answering agent prompts (permission, plan, question), alerts inside the app, ntfy subscribe flow, watch-only versus control handling.
- Relay additions: `GET /v1/devices/me` now also says `scope`; new `GET /v1/push` tells a paired phone its ntfy topic.

## Known gaps
- Multi-question agent prompts show only the first question.
- Terminal rendering draws styled text per row with a fixed font size; no pinch zoom, no selection or copy, wide characters may misalign the cursor.
- If the Mac removes a phone, the app finds out after three failed reconnects and then returns to pairing.
- Expo Go allowing plain `ws://` to a Tailscale address is expected but unverified.
- Background alerts only come through the ntfy app; BRB itself cannot run in the background on iOS without paid push entitlements.
- Android is untested.
