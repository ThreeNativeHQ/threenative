#!/usr/bin/env bash
# The `tn-local` self-hosted runner pool (PRD-480).
#
#   scripts/ci-runners.sh up [N]   build the image, run N disposable heavy runner containers plus
#                                  one light one, then set the TN_RUNNER and TN_RUNNER_LIGHT
#                                  repository variables so the routing expressions in ci.yml and
#                                  integration-*.yml send Linux jobs here
#   scripts/ci-runners.sh down     clear both variables first, then stop everything
#   scripts/ci-runners.sh status   what is set, what is running, what is online
#
# `down` deletes the variables before it stops anything, so the kill switch is the same command as
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
LIGHT_LABEL=tn-local-light
VARIABLE=TN_RUNNER
LIGHT_VARIABLE=TN_RUNNER_LIGHT
ENV_FILE="${TN_RUNNERS_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/threenative/runners.env}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/threenative/ci-runners"
DEFAULT_SLOTS=5
# Cores never given to a slot, so the owner's desktop stays responsive under a full board.
HOST_CORES=2
ONLINE_TIMEOUT_SECONDS=300
# The light lane is a quota, not a reservation: one core of whatever a heavy slot is not using,
# 2 GB, and the highest OOM score of any container, so a small join is what gets killed under
# memory pressure rather than a 20-minute build.
LIGHT_SHAPE="--cpus 1 --memory 2g --memory-swap 2g --oom-score-adj 900"
# `/dev/kvm` for the heavy slots, and only where the host has one: `android-emulator-parity` boots a
# checksum-locked APK under `reactivecircus/android-emulator-runner`, which reads the device for
# read and write and otherwise falls back to a software boot. No KVM, no flag — a host without it
# still runs the pool, just without hardware acceleration, which that lane already reports instead
# of asserting. The light lane never gets it: nothing it runs emulates anything.
KVM_SHAPE=""
if [ -e /dev/kvm ]; then
  KVM_SHAPE="--device /dev/kvm"
fi

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
# cannot. The loop is what makes the pool survive the exit. `shape` carries the docker resource
# flags word-split on purpose (there is no array to expand through `bash -c`), and `labels` is the
# one label the container registers with — `--no-default-labels` means that label is all it has.
start_slot() {
  local slot="$1" state="$2" env_file="$3" repo="$4" shape="$5" labels="$6"
  setsid nohup bash -c '
    while [ ! -e "$1/stop" ]; do
      docker run --rm \
        --label tn-ci-runner=1 \
        $4 \
        --env-file "$2" \
        -e TN_RUNNER_REPO="$3" \
        -e TN_RUNNER_LABELS="$5" \
        tn-ci-runner || sleep 10
    done
  ' _ "$state" "$env_file" "$repo" "$shape" "$labels" >"$state/$slot.log" 2>&1 &
  echo "$!" >"$state/$slot.pid"
}

stop_slots() {
  local pid_file
  for pid_file in "$STATE_DIR"/*.pid; do
    [ -f "$pid_file" ] || continue
    kill "$(cat "$pid_file")" 2>/dev/null || true
  done
  # No `rm -rf` anywhere near a path built from a variable: the stop file is what stops the loops.
  : >"$STATE_DIR/stop"
  docker ps -q --filter label=tn-ci-runner=1 | xargs -r docker stop
}

# A runner stopped while idle stays registered offline forever: ephemeral runners deregister only
# after taking a job. Delete those so the runner list shows real capacity.
forget_offline() {
  gh api "repos/$1/actions/runners" --paginate --jq \
    '.runners[] | select(.status == "offline") | select(any(.labels[]; .name | startswith("tn-local"))) | .id' \
    2>/dev/null | while read -r id; do
      gh api -X DELETE "repos/$1/actions/runners/$id" >/dev/null 2>&1 || true
    done
}

online_count() {
  gh api "repos/$1/actions/runners" --paginate --jq "
    [.runners[] | select(.status == \"online\") | select(any(.labels[]; .name == \"$2\"))] | length
  " 2>/dev/null || echo 0
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

  forget_offline "$repo"
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
  [ $(( slots * 2 + HOST_CORES )) -le "$half" ] \
    || fail 2 "$slots slots need $(( slots * 2 )) cores plus $HOST_CORES for the host; this host has $half"
  local slot base
  for slot in $(seq 1 "$slots"); do
    base=$(( (slot - 1) * 2 ))
    start_slot "slot-$slot" "$STATE_DIR" "$ENV_FILE" "$repo" \
      "--cpuset-cpus $base,$(( base + 1 )),$(( base + half )),$(( base + half + 1 )) --memory 12g --memory-swap 12g --oom-score-adj 800 $KVM_SHAPE" \
      "$LABEL"
  done
  # One light slot, unpinned and quota-limited, labelled so heavy jobs cannot select it: a 10-second
  # join behind five 20-minute builds is the wait this lane exists to remove. It never reserves a
  # core, so the check above still describes exactly the cores this pool owns.
  start_slot light "$STATE_DIR" "$ENV_FILE" "$repo" "$LIGHT_SHAPE" "$LIGHT_LABEL"
  printf '%s heavy + 1 light runner container(s) starting; logs in %s\n' "$slots" "$STATE_DIR"

  # Only advertise the labels once the runners are really there: TN_RUNNER set with an empty pool
  # is a queue that never drains. Both labels wait, because a light runner that never came online
  # leaves its jobs queued behind the heavy pool forever. On timeout, take the whole thing back down
  # rather than leaving half a pool registered.
  local deadline=$(( $(date +%s) + ONLINE_TIMEOUT_SECONDS )) online light_online
  while :; do
    online="$(online_count "$repo" "$LABEL")"
    light_online="$(online_count "$repo" "$LIGHT_LABEL")"
    if [ "$online" -ge "$slots" ] && [ "$light_online" -ge 1 ]; then break; fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      gh variable delete "$VARIABLE" --repo "$repo" 2>/dev/null || true
      gh variable delete "$LIGHT_VARIABLE" --repo "$repo" 2>/dev/null || true
      stop_slots
      fail 1 "$online of $slots $LABEL and $light_online $LIGHT_LABEL runner(s) came online within ${ONLINE_TIMEOUT_SECONDS}s"
    fi
    sleep 10
  done

  gh variable set "$VARIABLE" --body "$LABEL" --repo "$repo"
  gh variable set "$LIGHT_VARIABLE" --body "$LIGHT_LABEL" --repo "$repo"
  printf '%s %s + %s %s online; %s=%s and %s=%s, so deleting either routes its jobs back\n' \
    "$online" "$LABEL" "$light_online" "$LIGHT_LABEL" \
    "$VARIABLE" "$LABEL" "$LIGHT_VARIABLE" "$LIGHT_LABEL"
}

down() {
  need gh
  local repo
  repo="$(repo_name)"
  # First, so no job is ever routed to a pool that is on its way out.
  local variable
  for variable in "$VARIABLE" "$LIGHT_VARIABLE"; do
    gh variable delete "$variable" --repo "$repo" 2>/dev/null \
      || printf 'TN_CI_RUNNERS: %s was already unset\n' "$variable" >&2
  done
  mkdir -p "$STATE_DIR"
  stop_slots
  forget_offline "$repo"
  printf '%s and %s cleared; runners stopping\n' "$VARIABLE" "$LIGHT_VARIABLE"
}

status() {
  need gh
  local repo
  repo="$(repo_name)"
  local variable label
  for variable in "$VARIABLE" "$LIGHT_VARIABLE"; do
    printf '%s=%s\n' "$variable" "$(gh variable get "$variable" --repo "$repo" 2>/dev/null || echo unset)"
  done
  printf 'containers: %s\n' "$(docker ps -q --filter label=tn-ci-runner=1 | wc -l | tr -d ' ')"
  for label in "$LABEL" "$LIGHT_LABEL"; do
    printf 'online %s runners (name, status, busy):\n' "$label"
    gh api "repos/$repo/actions/runners" --paginate --jq \
      ".runners[] | select(any(.labels[]; .name == \"$label\")) | \"  \\(.name)  \\(.status)  busy=\\(.busy)\"" \
      2>/dev/null || echo "  none reported"
  done
}

case "${1:-}" in
  up) shift; up "${1:-}" ;;
  down) down ;;
  status) status ;;
  *) fail 2 "usage: ci-runners.sh up [N] | down | status" ;;
esac
