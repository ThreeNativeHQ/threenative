#!/usr/bin/env bash
# Registers this container as an ephemeral `tn-local` runner — or `tn-local-light` for the light
# lane — and takes one job.
#
# The container is the disposable half of `scripts/ci-runners.sh up`: it configures, runs exactly
# one job, exits, and the host loop starts a fresh one. Nothing on the filesystem crosses jobs.
set -euo pipefail

# Fail closed and say which variable is missing. An ephemeral runner that registers without
# TN_RUNNER_REPO would point itself at whatever repository the token defaults to.
: "${RUNNER_ADMIN_TOKEN:?RUNNER_ADMIN_TOKEN is not set; pass the operator env file with --env-file}"
: "${TN_RUNNER_REPO:?TN_RUNNER_REPO is not set; the host loop passes owner/repo}"

registration_token="$(
  curl --fail --silent --show-error --request POST \
    --header "Authorization: Bearer $RUNNER_ADMIN_TOKEN" \
    --header "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${TN_RUNNER_REPO}/actions/runners/registration-token" \
  | jq --exit-status --raw-output '.token'
)"

# The admin token mints this one registration token and has no other business existing. Dropping it
# from this shell's environment is what keeps it out of every job `run.sh` hands to a workflow.
unset RUNNER_ADMIN_TOKEN

./config.sh \
  --unattended \
  --ephemeral \
  --replace \
  --url "https://github.com/${TN_RUNNER_REPO}" \
  --token "$registration_token" \
  --name "tn-$(hostname)" \
  --labels "${TN_RUNNER_LABELS:-tn-local}" \
  --no-default-labels

exec ./run.sh
