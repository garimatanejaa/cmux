# BRB — Milestone R1 prompt (relay copy, rename, security) — cmux fork layout

Paste everything below the line into a Claude Code session started in `~/Desktop/personal/cmux` (your fork of manaflow-ai/cmux). Do R0 first so you know the stock relay works on your Mac.

---

You are implementing milestone R1 of BRB, an open-source tool that lets a phone watch and control coding agents (Claude Code, Codex) running in cmux on a Mac. BRB lives in the top-level folder `brb/` of this repo, a fork of manaflow-ai/cmux (GPL-3.0-or-later). Its relay is copied from the MIT-licensed project https://github.com/NewTurn2017/cmux-remote. Our design doc is the source of truth; read it first if available. This milestone changes only the relay. Do not start the phone app, the TypeScript protocol package or ntfy (R2 to R4).

## Ground rules
- Read `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md` and `LICENSE` at the repo root first and follow them. Highlights: never quit, kill or replace the user's running /Applications/cmux.app; never run bare `xcodebuild`; do not edit `CHANGELOG.md`; run `python3 scripts/verify-local.py` before committing as AGENTS.md describes.
- Create all work on a branch `brb/r1` and edit ONLY inside `brb/`. Do not modify any other path in the repo.
- Never copy from the Business Source License directories listed in LICENSE (`web/`, `workers/ci-artifacts/`, `workers/iroh-v2/`, `workers/presence/`, `services/iroh-relay-minter/`, `cmux-tui/relays/cloudflare-do/`). BRB must not depend on cmux accounts, Iroh relays or any cmux cloud service.
- Bring in the relay by cloning https://github.com/NewTurn2017/cmux-remote into a temporary folder OUTSIDE the repo, then copy only the relay sources, `Package.swift`, scripts and docs into `brb/relay/` (history not needed). Put the upstream MIT LICENSE text in `brb/relay/LICENSE-MIT` and add `brb/NOTICE` saying the relay is based on cmux-remote by NewTurn2017 under MIT, and that BRB as a whole is GPL-3.0-or-later. Do not copy its iOS app into the build; place it under `brb/legacy/ios-app/` only for reference, excluded from the build.
- Never run anything that contacts the original author's servers or update feed.
- Keep every change small and tested. Run `swift test` after each step and commit after each step with a clear message.
- Do not log terminal text, tokens or pairing codes anywhere. Log device id, action type and time only.
- If something in this prompt does not match the code, stop and write the mismatch in `brb/docs/r1-notes.md` instead of guessing.
- Do not add features that are not listed here.

## Step 1: Copy in and rename
Rename the product to BRB everywhere it is user-facing or system-facing:
- launchd label `com.genie.cmuxremote` (or whatever the upstream label is) becomes `com.brb.relay`.
- Config and data directory `~/.cmuxremote` becomes `~/.brb`.
- Binary name `cmux-relay` becomes `brb-relay`. Update `Package.swift`, scripts (`brb/relay/scripts/install-launchd.sh`, `brb/relay/scripts/smoke-relay.sh`), docs and README.
- The old SwiftUI iOS app stays under `brb/legacy/ios-app/`, out of the build. It is replaced by the React Native app in R4.
- Add a one-time migration: if `~/.cmuxremote` exists and `~/.brb` does not, print a message telling the user to re-pair instead of copying tokens. Do not copy old tokens.
Acceptance: `swift build` and `swift test` pass, `scripts/smoke-relay.sh` passes under the new names, and a repo-wide search finds no remaining upstream product name except in LICENSE, NOTICE and legacy/.

## Step 2 (S6): Remove the auto-updater
- Find the updater code and anything in the launchd install script that schedules it (search for update, Sparkle, releases, github.com, `--no-auto-update`).
- Remove it entirely. Delete the flag. The relay must make no network request to any host except through the local Tailscale and cmux sockets.
- Add a test or script check that fails if the source contains a URL to the upstream GitHub repository outside LICENSE, NOTICE and docs.
Acceptance: no updater code path remains; docs say updates are manual (`git pull`, rebuild, rerun the install script).

## Step 3 (S2): Bind to the Tailscale interface only
- Today the default listen address is `0.0.0.0:4399` (see `brb/relay/Sources/RelayCore/ConfigLoader.swift`). Change the default so the relay listens only on the Mac's Tailscale IPv4 address, discovered from `tailscale ip -4` or the local Tailscale API the code already uses.
- Config option `listen` may override it. If the value is `0.0.0.0` or `::`, print a clear warning at startup and require `allow_all_interfaces: true` in the config, otherwise refuse to start.
- If Tailscale is not running or has no address, do not listen. Retry every 10 seconds and log one line per state change.
- Keep the existing Tailscale identity (whois) check as a second layer.
Acceptance: tests cover address discovery with a fake runner, refusal on 0.0.0.0 without the flag, and no listener when Tailscale is down.

## Step 4 (S1): Pairing needs approval on the Mac
Current behavior: `POST /v1/devices/me/register` (see `registerNew` in `brb/relay/Sources/RelayServer/Routes.swift`) pairs any device whose Tailscale login is allowed. Change it:
- Add a `brb-relay pair` command (and a menu or CLI path that works without a GUI) that creates a pairing code. The code is at least 64 bits of randomness, shown in a short grouped format and also as a QR payload containing the Mac's Tailscale address, port and the code.
- Only a SHA-256 hash of the code and its expiry time are stored. The code works once and expires after `pairing_code_lifetime` (config, default 1 hour, allowed range 5 minutes to 24 hours; reject values outside the range). Creating a new code deletes any unused older one.
- `register` must require the code in the request body. Missing, wrong, expired or already-used codes return 403 with the same body, and each failure is logged and counted for Step 6.
- Keep the Tailscale peer check and allow-login check as additional conditions, not replacements.
- The localhost dev bypass must be compiled out of release builds (guard it with `#if DEBUG`) and must be off by default in debug builds unless an explicit environment variable is set.
- Re-pairing the same device replaces its token only through the same code flow.
Acceptance: tests for first use, reuse, expiry (use an injectable clock), replacement of an older code, wrong code, and that the raw code never appears in storage or logs.

## Step 5 (S3, relay side): Scopes, audit log, revoke
- Each device record gets a `scope`: `read` or `control`. New devices default to `read`. Add `brb-relay devices` (list), `brb-relay devices set-scope <id> control|read`, `brb-relay devices revoke <id>` and `brb-relay devices revoke-all`.
- Enforce scope in the relay, not the app: requests that send text or keys to a terminal (`surface.send_text`, `surface.send_key`, feed reply methods) are rejected with 403 for `read` devices. Reading screens and events stays allowed.
- Add an append-only audit log at `~/.brb/audit.log` (mode 0600, one JSON object per line): time, device id, scope, method name, workspace and surface ids, result. Never write terminal text or key contents. Rotate at 5 MB, keep 3 files.
- Revoking a device closes its open WebSocket connections immediately.
- Leave the confirm-tap behavior for the app milestone (R5); only expose a `requires_confirm` flag in the protocol for risky methods and document it in `brb/docs/protocol.md`.
Acceptance: tests for scope enforcement on each control method, audit lines contain no text payloads, revoke closes live sockets.

## Step 6 (S4): Rate limiting and lockout
- Apply limits to `register` and to any request that carries a token. Per source address: 10 failures in 10 minutes triggers a lockout starting at 1 minute and doubling up to 1 hour. Per device id: 5 bad tokens in 10 minutes triggers the same.
- Locked-out sources get 429 with a Retry-After header and the attempt is logged. Successful requests never count.
- Counters are in memory and reset on restart, except that a lockout in progress is also written to disk so a restart does not clear it.
Acceptance: tests with an injectable clock for threshold, doubling, expiry of the lockout, and that valid requests from a locked-out source are also refused until it ends.

## Step 7: Docs and wrap-up
- Add `brb/README.md` (what BRB is, install, pairing flow with `brb-relay pair`), `brb/docs/security.md` describing S1 to S4 and S6 as implemented, and write `brb/docs/r1-notes.md` with any mismatches, decisions and open items.
- From `brb/relay/` run `swift build`, `swift test` and `scripts/smoke-relay.sh`. Report results. Do not open a PR and do not push; stop with the branch committed locally.

## Definition of done for R1
Steps 1 to 7 complete, all tests pass, the smoke script passes, no network access to upstream, and `brb/docs/r1-notes.md` lists anything left. Do not mark R1 done if any acceptance check is missing.
