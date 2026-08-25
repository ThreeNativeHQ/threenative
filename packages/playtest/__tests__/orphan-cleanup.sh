#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/../../.." && pwd)"
cd "$repository_root"

owned_temp_root=0
suite_temp_root="${TN_SUITE_TMPDIR:-}"
if [[ -z "$suite_temp_root" || ! -d "$suite_temp_root" ]]; then
  suite_temp_root="$(mktemp -d /tmp/threenative-orphan-suite.XXXXXX)"
  owned_temp_root=1
fi
export TMPDIR="$suite_temp_root"

cleanup_temp_root() {
  if [[ "$owned_temp_root" -eq 1 ]]; then
    rm -rf -- "$suite_temp_root"
  fi
}
trap cleanup_temp_root EXIT

count_temp_directories() {
  find "$suite_temp_root" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | wc -l
}

case "${1:-}" in
  --suite-start)
    if [[ "$#" -ne 2 ]]; then
      echo "usage: $0 --suite-start MARKER" >&2
      exit 2
    fi
    {
      echo "$suite_temp_root"
      count_temp_directories
    } >"$2"
    echo "suite temporary directory baseline recorded: $(<"$2")"
    exit 0
    ;;
  --suite-finish)
    if [[ "$#" -ne 2 || ! -f "$2" ]]; then
      echo "usage: $0 --suite-finish MARKER" >&2
      exit 2
    fi
    before_temp_directories="$(sed -n '2p' "$2")"
    after_temp_directories="$(count_temp_directories)"
    if [[ "$after_temp_directories" != "$before_temp_directories" ]]; then
      echo "temporary directory count changed in suite namespace '$suite_temp_root': before $before_temp_directories, after $after_temp_directories" >&2
      exit 1
    fi
    echo "suite temporary directory count unchanged in '$suite_temp_root': $before_temp_directories"
    exit 0
    ;;
  "")
    ;;
  *)
    echo "usage: $0 [--suite-start MARKER|--suite-finish MARKER]" >&2
    exit 2
    ;;
esac

if ! browser_path="$(cd -- "$script_directory/.." && node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath());')"; then
  echo "unverified: Playwright Chromium is not available" >&2
  exit 2
fi
if [[ ! -x "$browser_path" ]]; then
  echo "unverified: Chromium executable is not installed at $browser_path" >&2
  exit 2
fi

before_temp_directories="$(count_temp_directories)"

set +e
run_log="$(mktemp)"
trap 'cleanup_temp_root; rm -f "$run_log"' EXIT
baseline_pids="$(ps -eo pid=)"
test_port="$(node --input-type=module -e '
  import { createServer } from "node:net";
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") process.exit(1);
    process.stdout.write(String(address.port));
    server.close();
  });
')"
timeout 5s node packages/playtest/dist/runner/cli.js \
  --scenario examples/abyss-framework/playtest/moves.json \
  --project . \
  --url "http://127.0.0.1:$test_port" \
  --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port $test_port --strictPort" >"$run_log" 2>&1
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

# Teardown is asynchronous: the runner kills the browser, and Playwright removes its profile and
# artifact directories a moment later. A fixed sleep made this gate a race — it passed on a quiet
# machine and failed on a loaded CI runner with `before 1, after 3`, reporting a leak that cleaned
# itself up a second after the count was taken. Poll to a deadline instead, and fail only when the
# state never settles. That still catches a real leak: a process or directory that is genuinely
# orphaned is still there when the deadline passes.
readonly settle_deadline_seconds="${TN_ORPHAN_SETTLE_SECONDS:-30}"

list_orphan_processes() {
  ps -eo pid=,args= | awk -v baseline="$baseline_pids" -v port_token="port $test_port" '
  BEGIN {
    count = split(baseline, pids, /[[:space:]]+/)
    for (idx = 1; idx <= count; idx += 1) if (pids[idx] != "") existing[pids[idx]] = 1
  }
  {
    if ($0 ~ /awk/) next
    pid = $1
    $1 = ""
    sub(/^[[:space:]]+/, "", $0)
    owned = index($0, port_token) || index($0, "playwright_chromiumdev_profile-") || index($0, "packages/playtest/dist/runner/cli.js")
    if (owned && !existing[pid]) print pid " " $0
  }'
}

orphans=""
after_temp_directories="$before_temp_directories"
settle_started="$SECONDS"
while true; do
  sleep 1
  orphans="$(list_orphan_processes)"
  after_temp_directories="$(count_temp_directories)"
  if [[ -z "$orphans" && "$after_temp_directories" -eq "$before_temp_directories" ]]; then
    break
  fi
  if (( SECONDS - settle_started >= settle_deadline_seconds )); then
    break
  fi
done

if [[ -n "$orphans" ]]; then
  echo "orphan processes remain after ${settle_deadline_seconds}s:" >&2
  echo "$orphans" >&2
  exit 1
fi

if [[ "$after_temp_directories" -ne "$before_temp_directories" ]]; then
  echo "temporary directory count changed in suite namespace '$suite_temp_root' and did not settle within ${settle_deadline_seconds}s: before $before_temp_directories, after $after_temp_directories" >&2
  find "$suite_temp_root" -mindepth 1 -maxdepth 1 -type d -print >&2 2>/dev/null || true
  exit 1
fi

if [[ "$unverified" -eq 1 ]]; then
  exit 2
fi

echo "no orphans"
