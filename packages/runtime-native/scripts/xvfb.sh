#!/bin/sh
# Run a command under a virtual X display and return the command's status.
#
# This copy is packaged with the installed desktop verifier. It must not resolve a helper from the
# engine checkout because the verifier is a consumer-facing command run from node_modules.
# `xvfb-run` is deliberately not used: its cleanup kill can replace a successful command status.
set -u

if [ "$#" -eq 0 ]; then
  echo "scripts/xvfb.sh: usage: scripts/xvfb.sh <command> [args...]" >&2
  exit 2
fi

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*) ;;
  *) exec "$@" ;;
esac

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "scripts/xvfb.sh: Xvfb is required for headless Linux runs and is not installed." >&2
  exit 2
fi

screen="${TN_XVFB_SCREEN:-1600x900x24}"
runtime="$(mktemp -d)"
display_file="$runtime/display"
: >"$display_file"

Xvfb -displayfd 3 -screen 0 "$screen" -nolisten tcp 3>"$display_file" &
xvfb_pid=$!

cleanup() {
  if kill -0 "$xvfb_pid" 2>/dev/null; then
    kill "$xvfb_pid" 2>/dev/null || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  rm -rf "$runtime"
}
trap cleanup EXIT INT TERM

display=""
waited=0
while [ "$waited" -lt 100 ]; do
  display="$(tr -d '[:space:]' <"$display_file")"
  [ -n "$display" ] && break
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "scripts/xvfb.sh: Xvfb exited before it reported a display" >&2
    exit 2
  fi
  sleep 0.1
  waited=$((waited + 1))
done

if [ -z "$display" ]; then
  echo "scripts/xvfb.sh: Xvfb did not report a display within 10 seconds" >&2
  exit 2
fi

DISPLAY=":$display"
export DISPLAY
"$@"
status=$?
exit "$status"
