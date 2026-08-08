#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/../../.." && pwd)"
cd "$repository_root"

if ! browser_path="$(cd -- "$script_directory/.." && node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath());')"; then
  echo "unverified: Playwright Chromium is not available" >&2
  exit 2
fi
if [[ ! -x "$browser_path" ]]; then
  echo "unverified: Chromium executable is not installed at $browser_path" >&2
  exit 2
fi

set +e
run_log="$(mktemp)"
trap 'rm -f "$run_log"' EXIT
timeout 5s node packages/playtest/dist/runner/cli.js \
  --scenario examples/abyss-framework/playtest/moves.json \
  --project . \
  --url http://127.0.0.1:5199 \
  --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5199 --strictPort' >"$run_log" 2>&1
run_code=$?
set -e

if [[ "$run_code" -ne 124 && "$run_code" -ne 2 ]]; then
  echo "orphan gate did not receive the expected timeout or signal exit (code $run_code)" >&2
  exit 1
fi
unverified=0
if [[ "$run_code" -eq 2 ]] && rg -q "TN_PLAYTEST_(BROWSER_UNAVAILABLE|SERVER_FAILED|PAGE_UNREACHABLE|RUNNER_FAILED|SCENARIO_|CLI_USAGE)" "$run_log"; then
  echo "unverified: the run failed before signal teardown could be exercised" >&2
  unverified=1
fi

sleep 2
orphans="$(ps -eo pid=,args= | awk '$0 !~ /awk/ && ($0 ~ /port 5199/ || $0 ~ /[Cc]hrom/)')"
if [[ -n "$orphans" ]]; then
  echo "orphan processes remain:" >&2
  echo "$orphans" >&2
  exit 1
fi

if [[ "$unverified" -eq 1 ]]; then
  exit 2
fi

echo "no orphans"
