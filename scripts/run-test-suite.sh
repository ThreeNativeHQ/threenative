#!/usr/bin/env bash
set -uo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/.." && pwd)"
cd "$repository_root"

status_path="${TN_GATE_STATUS_PATH:-$repository_root/artifacts/gates/status.json}"
run_id="${TN_GATE_RUN_ID:-tn-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
lease_owner="${TN_WORKTREE_OWNER:-${USER:-unknown}@$(hostname)}"
lease_pid="$$"
lease_registered=0
suite_started=0
run_status=0
resume_mode=0
resume_phase=""
heartbeat_pid=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --resume)
      resume_mode=1
      shift
      ;;
    --status-path)
      status_path="${2:-}"
      shift 2
      ;;
    --run-id)
      run_id="${2:-}"
      shift 2
      ;;
    --phase)
      resume_phase="${2:-}"
      shift 2
      ;;
    *)
      printf 'usage: run-test-suite.sh [--resume --status-path path --run-id id --phase phase]\n' >&2
      exit 2
      ;;
  esac
done

if [[ "$resume_mode" -eq 1 && -z "$resume_phase" ]]; then
  printf 'resume requires --phase\n' >&2
  exit 2
fi

suite_marker="$(mktemp /tmp/tn-suite-count.XXXXXX)"
lease_branch="$(git symbolic-ref -q HEAD || true)"
lease_head="$(git rev-parse HEAD)"

cleanup() {
  if [[ "$heartbeat_pid" -gt 0 ]]; then
    kill "$heartbeat_pid" >/dev/null 2>&1 || true
    wait "$heartbeat_pid" >/dev/null 2>&1 || true
    heartbeat_pid=0
  fi
  if [[ "$lease_registered" -eq 1 && "$run_status" -eq 0 ]]; then
    pnpm exec tsx scripts/worktree-lifecycle.ts release --owner "$lease_owner" --pid "$lease_pid" >/dev/null 2>&1 || true
    lease_registered=0
  fi
  rm -f "$suite_marker"
}
trap cleanup EXIT

set +e
lease_phase="test"
if [[ "$resume_mode" -eq 1 ]]; then
  lease_phase="$resume_phase"
fi
pnpm exec tsx scripts/worktree-lifecycle.ts register \
  --phase "$lease_phase" \
  --owner "$lease_owner" \
  --pid "$lease_pid" \
  --run-id "$run_id"
register_status=$?
if [[ "$register_status" -ne 0 ]]; then
  run_status=2
  exit 2
fi
lease_registered=1

packages/playtest/__tests__/orphan-cleanup.sh --suite-start "$suite_marker"
start_status=$?
if [[ "$start_status" -ne 0 ]]; then
  run_status="$start_status"
  exit "$start_status"
fi
suite_started=1

run_phase() {
  local phase="$1"
  shift
  local command_text="$*"
  local guard_status=0
  local status_start=0
  local child_status=0
  local status_finish=0
  local child_pid=0

  pnpm exec tsx scripts/worktree-lifecycle.ts verify --phase "$phase" --owner "$lease_owner" --pid "$lease_pid"
  guard_status=$?
  if [[ "$guard_status" -ne 0 ]]; then
    return "$guard_status"
  fi

  node scripts/gate-records.mjs start \
    --status-path "$status_path" \
    --run-id "$run_id" \
    --phase "$phase" \
    --owner "$lease_owner" \
    --pid "$lease_pid" \
    --command "$command_text"
  status_start=$?
  if [[ "$status_start" -ne 0 ]]; then
    return "$status_start"
  fi

  "$@" &
  child_pid=$!
  (
    while kill -0 "$child_pid" >/dev/null 2>&1; do
      sleep "${TN_GATE_HEARTBEAT_INTERVAL_SECONDS:-5}"
      if ! kill -0 "$child_pid" >/dev/null 2>&1; then
        break
      fi
      node scripts/gate-records.mjs heartbeat \
        --status-path "$status_path" \
        --run-id "$run_id" \
        --phase "$phase" \
        --owner "$lease_owner" \
        --pid "$lease_pid" >/dev/null 2>&1 || exit 0
      pnpm exec tsx scripts/worktree-lifecycle.ts heartbeat \
        --run-id "$run_id" \
        --phase "$phase" \
        --owner "$lease_owner" \
        --pid "$lease_pid" >/dev/null 2>&1 || exit 0
    done
  ) &
  heartbeat_pid=$!

  wait "$child_pid"
  child_status=$?
  kill "$heartbeat_pid" >/dev/null 2>&1 || true
  wait "$heartbeat_pid" >/dev/null 2>&1 || true
  heartbeat_pid=0

  node scripts/gate-records.mjs finish \
    --status-path "$status_path" \
    --run-id "$run_id" \
    --phase "$phase" \
    --owner "$lease_owner" \
    --pid "$lease_pid" \
    --exit-code "$child_status"
  status_finish=$?
  if [[ "$child_status" -ne 0 ]]; then
    return "$child_status"
  fi
  return "$status_finish"
}

test_status=0
if [[ "$resume_mode" -eq 1 ]]; then
  case "$resume_phase" in
    docs)
      run_phase docs pnpm run check:docs || test_status=$?
      ;;
    build)
      run_phase build pnpm run build || test_status=$?
      ;;
    unit)
      run_phase unit vitest run || test_status=$?
      ;;
    package-test)
      run_phase package-test pnpm -r --workspace-concurrency=1 --if-present run test || test_status=$?
      ;;
    *)
      printf 'cannot resume unknown phase %q\n' "$resume_phase" >&2
      test_status=2
      ;;
  esac
else
  run_phase docs pnpm run check:docs || test_status=$?
  if [[ "$test_status" -eq 0 ]]; then
    run_phase build pnpm run build || test_status=$?
  fi
  if [[ "$test_status" -eq 0 ]]; then
    run_phase package-test pnpm -r --workspace-concurrency=1 --if-present run test || test_status=$?
  fi
  if [[ "$test_status" -eq 0 ]]; then
    run_phase unit vitest run || test_status=$?
  fi
fi

finish_status=0
if [[ "$suite_started" -eq 1 ]]; then
  packages/playtest/__tests__/orphan-cleanup.sh --suite-finish "$suite_marker"
  finish_status=$?
fi

if [[ "$test_status" -ne 0 ]]; then
  run_status="$test_status"
  exit "$test_status"
fi
run_status="$finish_status"
exit "$finish_status"
