#!/usr/bin/env bash
# The `tn-local` self-hosted runner pool (PRD-480).
#
#   scripts/ci-runners.sh up [N]   build the image, run N disposable runner containers, then set
#                                  the TN_RUNNER repository variable so the routing expression in
#                                  ci.yml and integration-*.yml sends Linux jobs here
#   scripts/ci-runners.sh down     clear TN_RUNNER first, then stop everything
#   scripts/ci-runners.sh status   what is set, what is running, what is online
#
# `down` deletes the variable before it stops anything, so the kill switch is the same command as
# the teardown: jobs go back to hosted runners the moment it is deleted, whether or not the
# containers are still there.
#
# The operator's token lives in an untracked env file outside the repository and is never printed.
# It reaches the containers only through `docker run --env-file`, and the container's entrypoint
# unsets it before `run.sh` starts, so no job ever sees it.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."

IMAGE=tn-ci-runner
LABEL=tn-local
VARIABLE=TN_RUNNER
ENV_FILE="${TN_RUNNERS_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/threenative/runners.env}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/threenative/ci-runners"
DEFAULT_SLOTS=4
ONLINE_TIMEOUT_SECONDS=300

fail() {
  local code="$1"
  shift
  printf 'TN_CI_RUNNERS: %s\n' "$*" >&2
  exit "$code"
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail 2 "$1 is not on PATH"
}

# Fail closed before anything is built or started. A pool that came up without a token would
# register nothing and leave TN_RUNNER set for hosted jobs that never arrive.
load_config() {
  [ -n "$ENV_FILE" ] || fail 2 "TN_RUNNERS_ENV is empty"
  [ -f "$ENV_FILE" ] || fail 2 "no runner env file at $ENV_FILE; set TN_RUNNERS_ENV or create it with RUNNER_ADMIN_TOKEN=..."
  set -a
  # shellcheck disable=SC1090 # the operator's own untracked file
  . "$ENV_FILE"
  set +a
  # Read once for validation, then drop it: the token travels to the containers through
  # `--env-file`, never through this process's environment.
  [ -n "${RUNNER_ADMIN_TOKEN:-}" ] || fail 2 "RUNNER_ADMIN_TOKEN is unset or empty in $ENV_FILE"
  unset RUNNER_ADMIN_TOKEN
}

repo_name() {
  gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null \
    || fail 2 "gh could not resolve this checkout's owner/repo"
}

# One slot is a host-side loop, not a compose service: `docker run --rm` gives each job a fresh
# container filesystem and a fresh hostname, which `restart: always` on a long-lived container
# cannot. The loop is what makes the pool survive the exit.
start_slot() {
  local slot="$1" state="$2" env_file="$3" repo="$4" cpus="$5"
  setsid nohup bash -c '
    while [ ! -e "$1/stop" ]; do
      docker run --rm \
        --label tn-ci-runner=1 \
        --cpuset-cpus "$4" --memory 16g \
        --env-file "$2" \
        -e TN_RUNNER_REPO="$3" \
        tn-ci-runner || sleep 10
    done
  ' _ "$state" "$env_file" "$repo" "$cpus" >"$state/slot-$slot.log" 2>&1 &
  echo "$!" >"$state/slot-$slot.pid"
}

stop_slots() {
  local pid_file
  for pid_file in "$STATE_DIR"/slot-*.pid; do
    [ -f "$pid_file" ] || continue
    kill "$(cat "$pid_file")" 2>/dev/null || true
  done
  # No `rm -rf` anywhere near a path built from a variable: the stop file is what stops the loops.
  : >"$STATE_DIR/stop"
  docker ps -q --filter label=tn-ci-runner=1 | xargs -r docker stop
}

online_count() {
  gh api "repos/$1/actions/runners" --paginate --jq '
    [.runners[] | select(.status == "online") | select(any(.labels[]; .name == "tn-local"))] | length
  ' 2>/dev/null || echo 0
}

up() {
  local slots="${1:-${TN_RUNNERS:-$DEFAULT_SLOTS}}"
  case "$slots" in ''|*[!0-9]*) fail 2 "N must be a positive integer, got '$slots'" ;; esac
  [ "$slots" -ge 1 ] || fail 2 "N must be at least 1, got '$slots'"
  need docker
  need gh
  load_config
  local repo
  repo="$(repo_name)"

  docker build -t "$IMAGE" tools/ci-runners
  mkdir -p "$STATE_DIR"
  # A leftover stop file from a previous teardown would make every loop exit before it starts.
  rm -f "$STATE_DIR/stop"

  # Pinned CPUs, not a `--cpus 4` quota: under a quota `nproc` and os.availableParallelism() still
  # report every host CPU, so vitest sized its pool for 24 cores inside a 4-core budget and three
  # unit tests timed out (PR #404). Each slot takes two whole cores, both hyperthreads, as a hosted
  # 4-vCPU runner does.
  # ponytail: assumes Linux's usual sibling numbering (CPU k and k + nproc/2 share a core); read
  # /sys/devices/system/cpu/cpu*/topology/thread_siblings_list if a host numbers them otherwise.
  local half=$(( $(nproc) / 2 ))
  [ $(( slots * 2 )) -le "$half" ] || fail 2 "$slots slots need $(( slots * 2 )) cores; this host has $half"
  local slot base
  for slot in $(seq 1 "$slots"); do
    base=$(( (slot - 1) * 2 ))
    start_slot "$slot" "$STATE_DIR" "$ENV_FILE" "$repo" \
      "$base,$(( base + 1 )),$(( base + half )),$(( base + half + 1 ))"
  done
  printf '%s runner container(s) starting; logs in %s\n' "$slots" "$STATE_DIR"

  # Only advertise the label once the runners are really there: TN_RUNNER set with an empty pool
  # is a queue that never drains. On timeout, take the whole thing back down rather than leaving
  # half a pool registered.
  local deadline=$(( $(date +%s) + ONLINE_TIMEOUT_SECONDS )) online
  while :; do
    online="$(online_count "$repo")"
    [ "$online" -ge "$slots" ] && break
    if [ "$(date +%s)" -ge "$deadline" ]; then
      gh variable delete "$VARIABLE" --repo "$repo" 2>/dev/null || true
      stop_slots
      fail 1 "$online of $slots $LABEL runner(s) came online within ${ONLINE_TIMEOUT_SECONDS}s"
    fi
    sleep 10
  done

  gh variable set "$VARIABLE" --body "$LABEL" --repo "$repo"
  printf '%s online; %s=%s, so Linux jobs route here and deleting it routes them back\n' \
    "$online" "$VARIABLE" "$LABEL"
}

down() {
  need gh
  local repo
  repo="$(repo_name)"
  # First, so no job is ever routed to a pool that is on its way out.
  gh variable delete "$VARIABLE" --repo "$repo" 2>/dev/null \
    || printf 'TN_CI_RUNNERS: %s was already unset\n' "$VARIABLE" >&2
  mkdir -p "$STATE_DIR"
  stop_slots
  printf '%s cleared; runners stopping\n' "$VARIABLE"
}

status() {
  need gh
  local repo
  repo="$(repo_name)"
  printf '%s=%s\n' "$VARIABLE" "$(gh variable get "$VARIABLE" --repo "$repo" 2>/dev/null || echo unset)"
  printf 'containers: %s\n' "$(docker ps -q --filter label=tn-ci-runner=1 | wc -l | tr -d ' ')"
  printf 'online %s runners (name, status, busy):\n' "$LABEL"
  gh api "repos/$repo/actions/runners" --paginate --jq \
    ".runners[] | select(any(.labels[]; .name == \"$LABEL\")) | \"  \\(.name)  \\(.status)  busy=\\(.busy)\"" \
    2>/dev/null || echo "  none reported"
}

case "${1:-}" in
  up) shift; up "${1:-}" ;;
  down) down ;;
  status) status ;;
  *) fail 2 "usage: ci-runners.sh up [N] | down | status" ;;
esac
