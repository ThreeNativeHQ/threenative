# PRD-360 warm-up and cache verification — 2026-09-07

Status: implementation verified; **PRD-360 stays PARTIAL**. The 8-second median and 250 ms
pump-silence criteria are unchanged and still unmet — this record proves the warm-up host turn and
the relaunch hint, not the launch criterion. No physical cache-speed result is claimed because the
phone was unreachable during this follow-up.

## Red and green

The regression test was added before the fix. Against the old `warmUpScene`, the pending compile
case failed because the host yield was never called:

```text
FAIL packages/core/__tests__/warmup.spec.ts > scene warm-up > should yield while waiting for a native compile to settle
AssertionError: expected "vi.fn()" to be called at least once
```

The cache test also failed before the implementation because no cache status was reported:

```text
FAIL packages/core/__tests__/warmup.spec.ts > scene warm-up > should reuse a completed warm-up on the next launch
AssertionError: expected undefined to be 'stored'
```

After the fix:

```text
pnpm vitest run packages/core/__tests__/warmup.spec.ts packages/core/__tests__/warmup-default.spec.ts
✓ packages/core/__tests__/warmup.spec.ts (17 tests)
✓ packages/core/__tests__/warmup-default.spec.ts (4 tests)
Tests 21 passed
```

The game integration output records the behavior that matters:

```text
TN_WARMUP:{"compiled":1,"cache":"stored"}
TN_WARMUP:{"compiled":0,"cache":"hit"}
```

The first launch writes a marker only after a complete warm-up. The second launch skips the compile
walk. A blank key throws `TN_WARMUP_CACHE_INVALID`; storage failures return `cache: "unavailable"`
and continue the ordinary bounded warm-up.

Core typecheck also passed:

```text
pnpm --filter @threenative/core typecheck
exit 0
```

## Physical evidence boundary

The preserved candidate physical run reached its first frame at **16,020.007 ms** and moved
**2.146719 m** on a Pixel 8. Its host binary and full run artifacts are recorded by the prior
[Bayview repair review](https://github.com/ThreeNativeHQ/threenative/pull/136); that run proves
playability and a visible world. It is a single launch of the package already retained on the
device, not a cold install, so it is not a sample of what PRD-360's criterion measures — and at
16,020.007 ms it misses that 8-second criterion by roughly twice over regardless. One run is also
not the three-sample thermal benchmark the criterion requires. The baseline record retains three
preflight-qualified cold launches with a 49,788.7 ms median; its earlier plugged-in 50,948.7 ms set
is retained as superseded evidence.

The follow-up tried the recorded Wi-Fi device:

```text
List of devices attached
failed to connect to '192.168.1.192:5555': No route to host
List of devices attached
```

Because the device was unavailable, no physical cache-hit timing is reported. The new marker is an
opt-in hint for the platform driver's own persistent cache, not a serialized WebGPU pipeline.

## Follow-up — CI fixture hygiene, 2026-09-07

The `supply-chain` job was red on this branch: gitleaks' `generic-api-key` rule matched the
persistent-cache fixture key in `packages/core/__tests__/warmup-default.spec.ts:115` at entropy
`3.708132`. The value is a test cache key, not a credential. The fixture was renamed to an
obviously non-secret low-entropy string, and the already-published finding was scoped by its exact
commit/file/rule/line fingerprint in `.gitleaksignore`. The fingerprint is necessary because CI
scans every commit in the pull-request range: renaming the value in a later commit cannot remove
the historical finding. No scanner rule or path was suppressed, so any other finding still fails.

Reproduced locally with the same pinned scanner image and `git` mode the workflow uses. The whole
repository was mounted at its host path so the container could resolve the linked worktree's
`.git` pointer:

```text
# before — RED
docker run --rm -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0="$PWD" \
  -v /home/joao/projects/threenative/threenative-engine:/home/joao/projects/threenative/threenative-engine \
  ghcr.io/gitleaks/gitleaks@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb \
  git --redact --verbose --gitleaks-ignore-path "$PWD/.gitleaksignore" \
  --log-opts="origin/main..HEAD" "$PWD"
RuleID:      generic-api-key
Entropy:     3.708132
File:        packages/core/__tests__/warmup-default.spec.ts
Line:        115
Fingerprint: e2e871f1feac6fa0f7dc4d372f30d3cb586a8f72:packages/core/__tests__/warmup-default.spec.ts:generic-api-key:115
WRN leaks found: 1
exit 1

# after — GREEN (renamed fixture plus exact historical fingerprint)
INF 1 commits scanned.
INF no leaks found
exit 0
```

The behaviour the spec proves is unchanged; the key is only an opaque identity. Re-run after the
rename:

```text
pnpm exec vitest run packages/core/__tests__/warmup.spec.ts packages/core/__tests__/warmup-default.spec.ts
✓ packages/core/__tests__/warmup.spec.ts (18 tests)
✓ packages/core/__tests__/warmup-default.spec.ts (4 tests)
Tests 22 passed (22)
```

That is the current count on this branch; the 17/21 figures quoted above were recorded before the
later warm-up test landed and are not re-asserted here.
