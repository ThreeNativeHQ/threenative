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
# resolves for ubuntu24.04-x64 (playwright-core's bundled nativeDeps), transcribed so the apt layer
# does not depend on the Node layer below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build ccache clang lld pkg-config \
      git curl jq unzip zip xz-utils xvfb xauth python3 python3-pip \
      7zip ffmpeg imagemagick zstd file lsof procps \
      fonts-noto-color-emoji fonts-unifont fonts-liberation fonts-freefont-ttf \
      libfontconfig1 libfreetype6 \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
      libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

# Hosted ubuntu-24.04 ships Node 20 and gh on PATH, and jobs rely on both before any setup step:
# the `scope` job runs `node scripts/ci-change-scope.mjs` straight after checkout.
ARG NODE_VERSION=20.19.6
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=README.md --exclude=LICENSE \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /home/runner/entrypoint.sh

# Rust as hosted ubuntu-24.04 has it (stable, on PATH): the native physics ABI is built with cargo.
# Installed as `runner` so cargo can write its own registry and target caches.
USER runner
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH=/home/runner/.cargo/bin:$PATH
USER root
RUN chmod 0755 /home/runner/entrypoint.sh

USER runner
WORKDIR /home/runner
ENTRYPOINT ["/home/runner/entrypoint.sh"]
