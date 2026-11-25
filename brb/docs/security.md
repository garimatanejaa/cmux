# BRB security (R1)

What the relay does, and what it does not.

## Network
- Listens on the Tailscale IPv4 address only (`"listen": "tailscale:4399"`). If Tailscale is down it waits and listens on nothing.
- `0.0.0.0`, `::` and `*` are refused unless `allow_all_interfaces` is set to true in `~/.brb/relay.json`.
- Traffic is plain HTTP/WebSocket inside Tailscale's WireGuard tunnel. TLS on top is future work (S5).

## Pairing (S1)
- A phone needs a one-time code made on the Mac with `brb-relay pair`, as well as a valid Tailscale identity on the allow list.
- 16 characters of Crockford base32 (80 bits). Only a SHA-256 hash is stored, in a 0600 file.
- Single use. A new code replaces any unused one. Lifetime: 60 minutes by default, 5 to 1440 minutes.
- The localhost development bypass exists in debug builds only.

## Scopes (S3)
- `read`: list workspaces, read and subscribe to terminal output, read notifications. Allowlist, deny by default.
- `control`: everything else, including typing into terminals, except `relay.update.start` (never allowed).
- New devices are read-only unless the code was made with `--control`.
- Audit log `~/.brb/audit.log` (0600, rotated at 5 MB, 3 files): time, short device id, scope, method, workspace and surface ids, result. Never terminal text.

## Lockout (S4)
- 10 failures in 10 minutes from one address locks it out, starting at 60 s and doubling up to 1 hour.
- Registration answers 429 with Retry-After while locked out. Lockouts survive restart.

## Updates (S6)
- The auto-updater is disabled and its scripts removed. Update by pulling the repo and rebuilding.

## Known limits
- Control scope can run any cmux method that is not on the never list. A control device is as powerful as a person at the keyboard. Pair read-only unless you need control.
- Revoking a device closes its connection on its next request, not instantly.
- Per-device bad-token lockout is not implemented; lockout is per address.
