# R1 notes

Nothing here has been compiled or run yet by the author. First run `swift build` and `swift test` in `brb/relay` and fix what breaks.

## Done
S1 pairing code, S2 Tailscale-only bind, S3 scopes and audit log and revoke-all, S4 lockouts, S6 updater off, rename to BRB (`com.brb.relay`, `~/.brb`, `brb-relay`).

## Differences from the plan
- Lockout is per source address only. The bearer token carries no device id, so a per-device limit is not possible there.
- Bad bearer tokens get 401 while locked out; only registration returns 429.
- Revocation closes an open socket on the device's next request.
- The old iOS app was not copied.
- Internal module names (CmuxRemote*, SharedKit...) and the `cmuxremote.v1` subprotocol are unchanged to keep the diff small.
- The Swift update service types are still in the code but unreachable; `relay.update.start` is also on the never-allowed list.
- `parseListen` in CmuxRelay.swift is unused.
- Control scope allows any cmux method except the never list. A tighter allowlist is future work.

## Upstream
Derived from cmux-remote (MIT). See NOTICE and relay/LICENSE-MIT.
