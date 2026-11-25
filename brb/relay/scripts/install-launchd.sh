#!/usr/bin/env bash
# Install brb-relay as a per-user launchd agent (label com.brb.relay).
#
# Builds the release binary, copies it into ~/.brb/bin, renders
# ~/Library/LaunchAgents/com.brb.relay.plist, then bootstraps and kickstarts
# the agent. --dry-run validates and renders without writes or launchctl calls.
#
# BRB has no auto-updater. To update: git pull, then run this script again.

set -euo pipefail

LABEL="com.brb.relay"
DRY_RUN=0
PIN_SOCKET=""
PIN_SOCKET_SET=0

usage() {
  cat <<USAGE
Usage: install-launchd.sh [--dry-run] [--socket <path>]

Options:
  --dry-run        Print resolved paths and the rendered plist without
                   building, copying, writing LaunchAgents, or calling launchctl.
  --socket <path>  Pin brb-relay to a fixed cmux socket path. Omit to let the
                   relay discover the live cmux socket at runtime.
USAGE
}

socket_path_error() {
  echo "--socket requires a path" >&2
  usage >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --socket)
      [ "$#" -ge 2 ] || socket_path_error
      case "$2" in ""|-*) socket_path_error ;; esac
      PIN_SOCKET="$2"; PIN_SOCKET_SET=1; shift ;;
    --socket=*)
      PIN_SOCKET="${1#--socket=}"
      case "$PIN_SOCKET" in ""|-*) socket_path_error ;; esac
      PIN_SOCKET_SET=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/scripts/relay.plist.tmpl"
DEST="${BRB_HOME:-$HOME/.brb}"
BIN_SRC="$ROOT/.build/release/brb-relay"
BIN_DEST="$DEST/bin/brb-relay"
CONFIG="${BRB_RELAY_CONFIG:-$DEST/relay.json}"
LOGDIR="${BRB_RELAY_LOGDIR:-$DEST/log}"
SOCKET=""
if [ "$PIN_SOCKET_SET" -eq 1 ]; then
  SOCKET="$PIN_SOCKET"
fi
SELF_LOGIN_OPT_OUT="${CMUX_NO_SELF_LOGIN:-0}"
RELAY_PATH="${BRB_RELAY_PATH:-/usr/local/bin:/opt/homebrew/bin:/Applications/Tailscale.app/Contents/MacOS:/usr/bin:/bin:/usr/sbin:/sbin}"
LAUNCH_AGENTS_DIR="${BRB_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
TARGET="gui/$(id -u)"
SERVICE="$TARGET/$LABEL"
LAUNCHCTL="${BRB_RELAY_LAUNCHCTL:-launchctl}"
BUILD_CMD="${BRB_RELAY_BUILD_CMD:-swift build -c release --product brb-relay}"

note() { printf '[install-launchd] %s\n' "$*"; }
fail() { printf '[install-launchd] ERROR: %s\n' "$*" >&2; exit 1; }

if [ "$PIN_SOCKET_SET" -eq 0 ] && [ -n "${CMUX_SOCKET_PATH:-}" ]; then
  note "ignoring ambient CMUX_SOCKET_PATH=$CMUX_SOCKET_PATH"
  note "  (cmux exports it to processes it starts; pinning would break on socket rotation)"
  note "  pass --socket '$CMUX_SOCKET_PATH' if you really want to pin it"
fi

sed_escape() { printf '%s' "$1" | sed 's/[\\&|]/\\&/g'; }
xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
render_token() { sed_escape "$(xml_escape "$1")"; }

render_plist() {
  sed \
    -e "s|__BIN__|$(render_token "$BIN_DEST")|g" \
    -e "s|__CONFIG__|$(render_token "$CONFIG")|g" \
    -e "s|__SOCKET__|$(render_token "$SOCKET")|g" \
    -e "s|__LOGDIR__|$(render_token "$LOGDIR")|g" \
    -e "s|__NO_SELF_LOGIN__|$(render_token "$SELF_LOGIN_OPT_OUT")|g" \
    -e "s|__RELAY_PATH__|$(render_token "$RELAY_PATH")|g" \
    -e "s|__DEST__|$(render_token "$DEST")|g" \
    "$TEMPLATE"
}

validate_rendered_plist() {
  local tmp rc
  tmp="$(mktemp)"
  render_plist > "$tmp"
  if command -v plutil >/dev/null 2>&1; then
    if plutil -lint "$tmp" >/dev/null; then rc=0; else rc=$?; fi
  else
    rc=0
  fi
  rm -f "$tmp"
  return "$rc"
}

# launchctl bootout can return before launchd has dropped the job, and a
# bootstrap in that window fails. Wait for the job to go, then retry bootstrap.
bootstrap_job() {
  local waited=0 tries=0
  while "$LAUNCHCTL" print "$SERVICE" >/dev/null 2>&1; do
    [ "$waited" -lt 50 ] || break
    sleep 0.2
    waited=$(( waited + 1 ))
  done
  until "$LAUNCHCTL" bootstrap "$TARGET" "$PLIST"; do
    tries=$(( tries + 1 ))
    [ "$tries" -lt 5 ] || return 1
    sleep 1
  done
}

[ -f "$TEMPLATE" ] || fail "missing plist template: $TEMPLATE"

if [ -d "$HOME/.cmuxremote" ] && [ ! -d "$DEST" ]; then
  note "found an old ~/.cmuxremote folder. BRB does not reuse its tokens:"
  note "  pair your phone again with: brb-relay pair"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  note "dry-run; no build, copy, writes, or launchctl calls"
  note "label: $LABEL"
  note "binary: $BIN_DEST"
  if [ -f "$CONFIG" ]; then
    note "config: $CONFIG (exists)"
  else
    note "config: $CONFIG (would write default relay.json)"
  fi
  if [ -n "$SOCKET" ]; then
    note "socket override: $SOCKET"
  else
    note "socket override: <dynamic via cmux last-socket-path>"
  fi
  note "logdir: $LOGDIR"
  note "plist: $PLIST"
  note "would run: $BUILD_CMD"
  note "would copy: $BIN_SRC -> $BIN_DEST"
  note "would run: launchctl bootstrap $TARGET $PLIST"
  note "would run: launchctl kickstart -k $SERVICE"
  note "auto-update: none (BRB never updates itself)"
  printf '%s\n' '--- rendered plist ---'
  render_plist
  validate_rendered_plist
  exit 0
fi

command -v swift >/dev/null 2>&1 || fail "missing required tool: swift"
command -v "$LAUNCHCTL" >/dev/null 2>&1 || fail "missing required tool: launchctl"

if [ ! -f "$CONFIG" ]; then
  note "no config at $CONFIG; writing default relay.json"
  mkdir -p "$(dirname "$CONFIG")"
  chmod 700 "$(dirname "$CONFIG")"
  cat > "$CONFIG" <<'JSON'
{
  "listen":      "tailscale:4399",
  "default_fps": 15,
  "idle_fps":    5
}
JSON
  note "the relay listens on this Mac's Tailscale address only."
  note "this Mac's own tailnet login is auto-authorised. To allow other"
  note "  tailnet logins, add them to \"allow_login\" in $CONFIG."
fi

note "building release binary"
(cd "$ROOT" && /bin/bash -c "$BUILD_CMD")
[ -x "$BIN_SRC" ] || fail "release binary not found after build: $BIN_SRC"

note "installing binary and logs under $DEST"
mkdir -p "$DEST/bin" "$LOGDIR" "$LAUNCH_AGENTS_DIR"
chmod 700 "$DEST"
cp "$BIN_SRC" "$BIN_DEST.new"
chmod 755 "$BIN_DEST.new"
mv -f "$BIN_DEST.new" "$BIN_DEST"

note "rendering $PLIST"
render_plist > "$PLIST"
validate_rendered_plist

note "bootstrapping $LABEL"
"$LAUNCHCTL" bootout "$TARGET" "$PLIST" >/dev/null 2>&1 || true
bootstrap_job || fail "could not load $LABEL"
"$LAUNCHCTL" kickstart -k "$SERVICE"

note "installed $("$BIN_DEST" --version 2>/dev/null | head -n 1)"
note "next: run  $BIN_DEST pair --control  and enter the code in the BRB app"
