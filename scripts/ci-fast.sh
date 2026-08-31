#!/usr/bin/env bash
# The pre-push tier: everything that catches drift, and nothing that needs a GPU or a clock.
#
# Chosen by what actually broke `main` in one session: a spec pinning a template's old contract,
# a scaffold hash not recomputed with the bytes it hashes, relative links left dangling by a folder
# move, a manifest rewritten without Biome's formatting, and a stale generated census. Every one of
# those reproduces here in seconds and cost a 15-minute push-and-wait cycle to discover instead.
#
# Deliberately NOT here: `test`, `test-browser`, `test-playtest`, `golden-path`, `visuals`. They are
# minutes to tens of minutes, and a hook people skip is worse than no hook — it manufactures
# confidence without providing it. Those live in `pnpm ci:local`.
set -u
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
log_root="${TN_CI_FAST_LOGS:-$(mktemp -d /tmp/tn-ci-fast.XXXXXX)}"
mkdir -p "$log_root"

declare -a names=() cmds=()
add() { names+=("$1"); cmds+=("$2"); }
add lint      'pnpm lint'
add docs      'pnpm check:docs'
add typecheck 'pnpm typecheck'
add budgets   'pnpm budgets'
add agents    'pnpm sync:agents --check'
add drift     'pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts packages/create-threenative/__tests__/template.spec.ts packages/create-threenative/__tests__/playtest.spec.ts packages/create-threenative/__tests__/platformer.spec.ts scripts/__tests__/package-list-drift.spec.ts scripts/__tests__/xvfb.spec.ts scripts/__tests__/ci-structure.spec.ts'

status=0
for index in "${!names[@]}"; do
  name="${names[$index]}"
  printf '%-12s ' "$name"
  start=$(date +%s)
  if eval "${cmds[$index]}" >"$log_root/$name.log" 2>&1; then
    printf 'pass  %3ss\n' "$(( $(date +%s) - start ))"
  else
    printf 'FAIL  %3ss   %s\n' "$(( $(date +%s) - start ))" "$log_root/$name.log"
    status=1
  fi
done
exit "$status"
