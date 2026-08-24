#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/../../.." && pwd)"
cd "$repository_root"

# `/tmp` is shared by every agent lane working this repository, so counting every
# `/tmp/threenative-*` made this guard report a sibling's directories as this run's leak — and, when
# a sibling cleaned up mid-run, as this run's impossible negative leak. When the suite runner tags
# its run, count only the directories carrying that tag; `test-support/temp-dir.ts` puts it there,
# and PRD-135 already requires every temp directory to come from that helper. Without a tag the
# whole-directory count stands, so an ad-hoc invocation still sees everything.
count_temp_directories() {
  if [[ -n "${TN_TEST_TEMP_TAG:-}" ]]; then
    ls -d /tmp/threenative-*"${TN_TEST_TEMP_TAG}"* 2>/dev/null | wc -l || true
  else
    ls -d /tmp/threenative-* 2>/dev/null | wc -l || true
  fi
}

case "${1:-}" in
  --suite-start)
    if [[ "$#" -ne 2 ]]; then
      echo "usage: $0 --suite-start MARKER" >&2
      exit 2
    fi
    count_temp_directories >"$2"
    echo "suite temporary directory baseline recorded: $(<"$2")"
    exit 0
    ;;
  --suite-finish)
    if [[ "$#" -ne 2 || ! -f "$2" ]]; then
      echo "usage: $0 --suite-finish MARKER" >&2
      exit 2
    fi
    before_temp_directories="$(<"$2")"
    after_temp_directories="$(count_temp_directories)"
    if [[ "$after_temp_directories" != "$before_temp_directories" ]]; then
      echo "temporary directory count changed across the full test suite: before $before_temp_directories, after $after_temp_directories" >&2
      exit 1
    fi
    echo "suite temporary directory count unchanged: $before_temp_directories"
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
trap 'rm -f "$run_log"' EXIT
baseline_pids="$(ps -eo pid= | tr -d ' ')"
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

sleep 2
orphans="$(ps -eo pid=,args= | awk -v baseline="$baseline_pids" -v port_token="port $test_port" '
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
  }')"
if [[ -n "$orphans" ]]; then
  echo "orphan processes remain:" >&2
  echo "$orphans" >&2
  exit 1
fi

after_temp_directories="$(count_temp_directories)"
if [[ "$after_temp_directories" -ne "$before_temp_directories" ]]; then
  echo "temporary directory count changed: before $before_temp_directories, after $after_temp_directories" >&2
  exit 1
fi

if [[ "$unverified" -eq 1 ]]; then
  exit 2
fi

echo "no orphans"
