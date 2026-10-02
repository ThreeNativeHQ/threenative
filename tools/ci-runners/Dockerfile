# The `tn-local` self-hosted runner image (PRD-480). One container per job: `scripts/ci-runners.sh`
# starts a host-side loop of `docker run --rm`, so nothing survives a job but the image itself.
#
# Ubuntu 24.04 to match hosted `ubuntu-24.04`, with the `runner` user's passwordless sudo intact so
# the workflow's own `sudo apt-get install` steps keep working. The Docker CLI is deliberately
# absent and the socket is never mounted: `supply-chain` needs `docker run` for gitleaks and stays
# on a hosted runner for exactly that reason.
FROM ghcr.io/actions/actions-runner:latest

USER root

# Build and test toolchain the moving Linux jobs take from the hosted image. `git`, `curl`, `jq`
# and `unzip` are the runner's own prerequisites; the rest is what ci.yml's jobs actually invoke.
# Playwright's Chromium dependencies are the exact `tools` and `chromium` lists Playwright 1.62.1
# resolves for ubuntu24.04-x64 (playwright-core's bundled nativeDeps), transcribed rather than
# installed with `npx playwright install-deps` — that needs a Node runtime the runner image does
# not ship and every job gets its own through `actions/setup-node`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build ccache clang lld pkg-config \
      git curl jq unzip zip xz-utils xvfb xauth python3 python3-pip \
      fonts-noto-color-emoji fonts-unifont fonts-liberation fonts-freefont-ttf \
      libfontconfig1 libfreetype6 \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
      libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /home/runner/entrypoint.sh
RUN chmod 0755 /home/runner/entrypoint.sh

USER runner
WORKDIR /home/runner
ENTRYPOINT ["/home/runner/entrypoint.sh"]
