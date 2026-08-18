#!/usr/bin/env bash
set -uo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/.." && pwd)"
cd "$repository_root"

suite_marker="$(mktemp /tmp/tn-suite-count.XXXXXX)"
cleanup() {
  rm -f "$suite_marker"
}
trap cleanup EXIT

set +e
packages/playtest/__tests__/orphan-cleanup.sh --suite-start "$suite_marker"
start_status=$?
if [[ "$start_status" -ne 0 ]]; then
  exit "$start_status"
fi

pnpm run build && pnpm -r --workspace-concurrency=1 --if-present run test && vitest run
test_status=$?

packages/playtest/__tests__/orphan-cleanup.sh --suite-finish "$suite_marker"
finish_status=$?

if [[ "$test_status" -ne 0 ]]; then
  exit "$test_status"
fi
exit "$finish_status"
