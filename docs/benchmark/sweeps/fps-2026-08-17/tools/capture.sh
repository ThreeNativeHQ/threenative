#!/bin/sh
# Run a command under a virtual X display and exit with *that command's* status.
#
# `xvfb-run` cannot be used for this. In xorg-server-xvfb 21.1.24 it captures the
# command's status into RETVAL, re-enables `set -e`, and only then runs its cleanup
# `kill $XVFBPID`. When Xvfb has already exited on its own the kill fails, errexit
# aborts the script at that line, and the failing kill's status replaces RETVAL. The
# observable result is that `xvfb-run -a -s '-screen 0 1600x900x24' true` exits 1, so
# every gate wrapped in it reports failure whether it passed or not.
#
# Screen geometry comes from TN_XVFB_SCREEN and defaults to the repository's usual
# 1600x900x24.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/xvfb.sh <command> [args...]" >&2
  exit 2
fi

screen="${TN_XVFB_SCREEN:-1600x900x24}"
runtime="$(mktemp -d)"
display_file="$runtime/display"
: >"$display_file"

# -displayfd lets Xvfb choose a free display and report it, which avoids the lock-file
# race two concurrent gates would otherwise hit.
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

# cleanup runs on EXIT; the command's status is what leaves this script.
exit "$status"
