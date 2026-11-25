#!/usr/bin/env bash
# Remove the per-user brb-relay launchd agent plist and unload it if present.
# relay.json, devices.json, the audit log and the relay binary stay under ~/.brb.

set -euo pipefail

LABEL="com.brb.relay"
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: uninstall-launchd.sh [--dry-run]

Options:
  --dry-run  Print the launchctl/rm actions without changing launchd or files.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

LAUNCH_AGENTS_DIR="${BRB_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
TARGET="gui/$(id -u)"
LAUNCHCTL="${BRB_RELAY_LAUNCHCTL:-launchctl}"

note() { printf '[uninstall-launchd] %s\n' "$*"; }

if [ "$DRY_RUN" -eq 1 ]; then
  note "dry-run; nothing changed"
  note "would run: launchctl bootout $TARGET $PLIST"
  note "would remove: $PLIST"
  exit 0
fi

"$LAUNCHCTL" bootout "$TARGET" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
note "removed $LABEL. Data under ~/.brb was left in place."
