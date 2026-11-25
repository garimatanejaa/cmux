# BRB

BRB. Your agents keep going.

BRB lets your phone watch and control coding agents (Claude Code, Codex) that run in cmux panes on your Mac. Everything is free to run: Tailscale free tier for the network, ntfy.sh for push notifications later, no paid Apple developer account.

Status: R1 only. This folder holds the Mac-side relay (`brb/relay`). The phone app and notifications come later.

## Build and test (on the Mac)

    cd brb/relay
    swift build
    swift test

## Use

1. Install Tailscale on the Mac and the phone, and sign in to the same tailnet.
2. Start the relay: `swift run brb-relay serve` (or `scripts/install-launchd.sh` to run it at login).
   It listens on your Tailscale address only, port 4399.
3. On the Mac, make a pairing code: `swift run brb-relay pair` (read-only) or `brb-relay pair --control` (can type into terminals).
   The code works once and expires after 60 minutes by default (`--lifetime-minutes 5..1440`).
4. Enter the code in the phone app. It registers and gets its own token.

Manage phones:

    brb-relay devices list
    brb-relay devices set-scope <id> read|control
    brb-relay devices revoke <id>
    brb-relay devices revoke-all

Data lives in `~/.brb` (override with `BRB_HOME`). See `docs/security.md`.
