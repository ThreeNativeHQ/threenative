#!/bin/sh
# Run a command under a virtual X display and exit with *that command's* status.
#
# Compatibility path: since the capture-environment bake-in (abstraction report §2.10), the
# playtest runner provisions its own private Xvfb per run and strips the Wayland variables,
# so wrapping a playtest in this script is OPTIONAL — `threenative-playtest ... --headed`
# works bare on a headless Linux box with Xvfb installed. This wrapper remains the general
# answer for any OTHER command that needs an X display (gates, profilers, one-off scripts)
# and keeps working unchanged for callers that still use it.
#
# `xvfb-run` cannot be used for this. In xorg-server-xvfb 21.1.24 it captures the
# command's status into RETVAL, re-enables `set -e`, and only then runs its cleanup
# `kill $XVFBPID`. When Xvfb has already exited on its own the kill fails, errexit
# aborts the script at that line, and the failing kill's status replaces RETVAL. The
# observable result is that `xvfb-run -a -s '-screen 0 1600x900x24' true` exits 1, so
# every gate wrapped in it reports failure whether it passed or not.
#
# Screen geometry comes from TN_XVFB_SCREEN and defaults to the repository's usual
# 1600x900x24 (the same variable the runner's private-Xvfb path honours).
#
# Only Linux needs this. Xvfb is an X11 server, so it does not exist on macOS or Windows,
# where the OS already provides a display and the wrapper is a no-op that must still hand
# back the command's own status. Wrapping every gate in this script therefore stays correct
# on a contributor's machine that is not Linux.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/xvfb.sh <command> [args...]" >&2
  exit 2
fi

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*) ;;
  *)
    # macOS, the BSDs and Git Bash on Windows: run it where the display already is.
    exec "$@"
    ;;
esac

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "scripts/xvfb.sh: Xvfb is required for headless runs on Linux and is not installed." >&2
  echo "scripts/xvfb.sh: install it (Debian/Ubuntu 'xvfb', Arch 'xorg-server-xvfb', Fedora" >&2
  echo "scripts/xvfb.sh: 'xorg-x11-server-Xvfb'). Refusing to run blind." >&2
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

# 10s was enough until a loaded two-core CI runner missed it: run 33789430714's installed-verifier
# case reported "Xvfb did not report a display within 10 seconds" while Xvfb was still alive and
# starting. The loop already exits the moment Xvfb dies, so a higher ceiling costs a healthy run
# nothing and only buys a slow one time. Tenths of a second.
display_wait_tenths=300
display=""
waited=0
while [ "$waited" -lt "$display_wait_tenths" ]; do
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
  echo "scripts/xvfb.sh: Xvfb did not report a display within $((display_wait_tenths / 10)) seconds" >&2
  exit 2
fi

DISPLAY=":$display"
export DISPLAY

"$@"
status=$?

# cleanup runs on EXIT; the command's status is what leaves this script.
exit "$status"
