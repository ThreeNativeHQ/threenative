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
# 1600x900x24 (the same variable the runner's private-Xvfb path honours). The display also gets
# the COMPOSITE and SHAPE extensions and a compositing manager when one is installed, because the
# native desktop runtime cannot blend its UI overlay on a display without them.
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

# One implementation, not two. The packaged copy is the one that ships to installed consumers, so
# it must stand alone; this one is free to call it, and calling it is what keeps the two from
# drifting -- a display fix once landed in the packaged copy alone and no gate in this repository
# ever executed it.
case "$0" in
  */*) here="${0%/*}" ;;
  *) here="." ;;
esac
helper="$here/../packages/runtime-native/scripts/xvfb.sh"
if [ ! -f "$helper" ]; then
  echo "scripts/xvfb.sh: the packaged wrapper is missing at $helper" >&2
  exit 2
fi

exec /bin/sh "$helper" "$@"
