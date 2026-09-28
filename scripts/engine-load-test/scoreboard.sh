#!/bin/sh
# PRD-449 scoreboard: TN vs Godot on one cube scene. Rows: shipped defaults (TN L3 / Godot L1),
# explicit instancing (L2 / L2), can't batch (L4 / L4), at 1,024 and 4,096 cubes; 3 alternating
# runs per engine, 40 warmup + 120 measured, 1280x720 uncapped on the physical display.
# Usage: pnpm bench:scoreboard [tag]   (tag defaults to today's date; outputs never overwrite)
set -u
tag=${1:-$(date +%F)}
export DISPLAY=${DISPLAY:-:0} TN_BENCH_DISPLAY=${TN_BENCH_DISPLAY:-${DISPLAY:-:0}}
export GODOT_BIN=${GODOT_BIN:-$PWD/artifacts/engine-load-test/prd-449/godot-bin/Godot_v4.7.1-stable_linux.x86_64}
run() {
  pnpm -s bench:engines --arm "$1-desktop" --ladder 1024,4096 --modes "$2" --frames 160 --warmup 40 \
    --repeats 1 --skip-baseline --out "prd-449/pilots/scoreboard-$1-r$3-$tag" || exit 1
}
run tn L2,L3,L4 1; run godot L1,L2,L4 1
run godot L1,L2,L4 2; run tn L2,L3,L4 2
run tn L2,L3,L4 3; run godot L1,L2,L4 3
pnpm -s bench:engines:monitor
