#!/usr/bin/env bash
# Run what CI runs, here, so a red is found in minutes instead of a push-and-wait cycle.
#
# Every job below is the same command the workflow invokes. Two caveats the output repeats, because
# a local pass is not a CI pass:
#   - this machine has a real GPU and more cores, so timing-shaped failures (an operation budget, a
#     job timeout) can pass here and fail there;
#   - `native-platforms` is not run: it needs the hosted matrix.
# Everything else — spec drift, hash drift, doc links, lint, budgets — reproduces exactly.
set -u
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
only="${1:-}"
log_root="${TN_CI_LOCAL_LOGS:-$(mktemp -d /tmp/tn-ci-local.XXXXXX)}"
mkdir -p "$log_root"
echo "logs: $log_root"

declare -a names=() cmds=()
add() { names+=("$1"); cmds+=("$2"); }

add build     'pnpm tsx scripts/workspace-packages.ts build && pnpm --filter abyss-framework build && pnpm exec tsx scripts/check-core-boundary.ts'
add typecheck 'pnpm typecheck'
add lint      'pnpm lint'
add budgets   'pnpm budgets && pnpm quality && pnpm sync:agents --check'
add test      'pnpm test'
add benchmark 'pnpm tsx scripts/count-loc.ts --check && pnpm --filter abyss-vanilla build && pnpm exec vitest run scripts/__tests__/count-loc.spec.ts scripts/__tests__/score-blind.spec.ts'
add test-playtest 'pnpm test:playtest:ci'
add test-browser  'sh scripts/xvfb.sh pnpm test:browser'
add golden-path   'TN_PLAYTEST_ALLOW_SOFTWARE=1 pnpm verify:golden-path'
add visuals       'pnpm visuals'

status=0
for index in "${!names[@]}"; do
  name="${names[$index]}"
  [ -n "$only" ] && [ "$only" != "$name" ] && continue
  printf '%-16s ' "$name"
  start=$(date +%s)
  if eval "${cmds[$index]}" >"$log_root/$name.log" 2>&1; then
    printf 'pass  %3ss\n' "$(( $(date +%s) - start ))"
  else
    printf 'FAIL  %3ss   %s\n' "$(( $(date +%s) - start ))" "$log_root/$name.log"
    status=1
  fi
done

echo
echo "A local pass is not a CI pass: this machine has a GPU and more cores, so a budget or timeout"
echo "that fits here can still fail there. native-platforms is not covered."
exit "$status"
