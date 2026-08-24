#!/usr/bin/env bash
# The desktop UI overlay's input proof, on a display nobody is using.
#
# What it asserts, per window geometry:
#   in   — a press inside an interactive island reaches the PAGE and nothing else
#   out  — a press outside every island falls through to the GAME
# and it repeats that across sizes, a resize, and fullscreen, because the published rectangles
# are normalized and only the host turns them into pixels: a shape cut for the old size is the
# failure this exists to catch.
#
# Needs: Xvfb, xdotool, gcc, a built `mystral`, and the game/UI bundles named below.
set -uo pipefail

DISPLAY_NUM="${TN_PROOF_DISPLAY:-:3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="${TN_PROOF_WORK:?set TN_PROOF_WORK to a directory holding desktop-game.js and desktop-ui/}"
MYSTRAL="$ROOT/packages/runtime-native/build/tn-linux/mystral"
LOG="$WORK/proof-game.log"
failures=0

report() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; else echo "  FAIL  $1: expected $2, got $3"; failures=$((failures + 1)); fi
}

cc "$ROOT/packages/runtime-native/native/ui-overlay/tools/xcompmin.c" -o "$WORK/xcompmin" -lX11 -lXcomposite || exit 2

pkill -f "Xvfb $DISPLAY_NUM" 2>/dev/null; sleep 1
setsid Xvfb "$DISPLAY_NUM" -screen 0 1920x1080x24 +extension COMPOSITE +extension SHAPE -noreset \
  > "$WORK/xvfb.log" 2>&1 < /dev/null & disown
sleep 3
setsid env DISPLAY="$DISPLAY_NUM" "$WORK/xcompmin" > "$WORK/xcompmin.log" 2>&1 < /dev/null & disown
sleep 2
grep -q compositing "$WORK/xcompmin.log" || { echo "no compositing manager on $DISPLAY_NUM"; exit 2; }

pkill -x mystral 2>/dev/null; sleep 1
setsid env DISPLAY="$DISPLAY_NUM" SDL_VIDEODRIVER=x11 GDK_BACKEND=x11 TN_UI_OVERLAY_TRACE=1 \
  "$MYSTRAL" run "$WORK/desktop-game.js" --ui "$WORK/desktop-ui" > "$LOG" 2>&1 < /dev/null & disown
export DISPLAY="$DISPLAY_NUM"
for _ in $(seq 1 40); do grep -q '"attached":true' "$LOG" && break; sleep 1; done
grep -q '"attached":true' "$LOG" || { echo "the overlay never attached"; tail -5 "$LOG"; exit 1; }
WID=$(xdotool search --name "^ThreeNative$" | head -1)

# One press, reported as which side consumed it. Both sides count presses they actually received:
# the page turns a press on an island into an intent the game logs, and the game logs the pointer
# downs that reach its canvas. Neither is a state change, so a press repeated at the same place
# reads the same every time.
# The page's reaction runs for four seconds. Pressing again while it is still running counts its
# tail as the new press's answer, which is how the harness itself manufactured a false "the UI
# consumed a press it should have passed through".
settle() {
  local last=-1 now
  for _ in $(seq 1 20); do
    now=$(grep -c TN_UI_HIT_REGIONS "$LOG")
    [ "$now" = "$last" ] && return 0
    last=$now; sleep 1
  done
}

press() { # x_fraction y_fraction -> "ui" | "game" | "nobody"
  local ui_before game_before ui_after game_after
  settle
  ui_before=$(grep -c TN_SMOKE_UI_INTENT "$LOG"); game_before=$(grep -c TN_SMOKE_POINTER_DOWN "$LOG")
  eval "$(xdotool getwindowgeometry --shell "$WID")"
  echo "    press at $((X + WIDTH * $1 / 100)),$((Y + HEIGHT * $2 / 100)) | window ${WIDTH}x${HEIGHT}+${X}+${Y} | shape $(grep -o 'TN_UI_SHAPE:.*' "$LOG" | tail -1)" >&2
  xdotool mousemove --sync $((X + WIDTH * $1 / 100)) $((Y + HEIGHT * $2 / 100)); sleep 0.4
  xdotool click 1; sleep 2.5
  ui_after=$(grep -c TN_SMOKE_UI_INTENT "$LOG"); game_after=$(grep -c TN_SMOKE_POINTER_DOWN "$LOG")
  if [ $((ui_after - ui_before)) -gt 0 ]; then echo ui
  elif [ $((game_after - game_before)) -gt 0 ]; then echo game
  else echo nobody; fi
}

check_geometry() { # label
  echo "$1"
  report "press inside an island reaches the page" ui "$(press 85 50)"
  report "press outside every island reaches the game" game "$(press 50 12)"
}

check_geometry "at the window's starting size"
xdotool windowsize "$WID" 800 500; sleep 3
check_geometry "after shrinking to 800x500"
xdotool windowsize "$WID" 1600 900; sleep 3
check_geometry "after growing to 1600x900"
xdotool windowsize "$WID" 1920 1080; xdotool windowmove "$WID" 0 0; sleep 3
check_geometry "filling the screen"

pkill -x mystral 2>/dev/null
echo "failures: $failures"
[ "$failures" -eq 0 ]
