# PRD-359 task 7a — paired browser proof — 2026-09-06

This records the browser half of task 7a. The row remains open until the same
scenario is driven through the native resource bridge.

## Red/green

The first post-runner-fix proof still failed because killing the partner process
did not produce a server session end within the bounded wait:

```text
EXIT:1
error: killed partner session did not end within 30000ms (controlledKillMatched=11)
```

After process ownership was expanded to the Playwright profile, the negative
scenario exposed the second defect: the subject finished before the killed
peer's transport timeout and still reported `networkPeerObserved=true` at the
loss label. The server log showed the partner timing out while the subject's
scenario ended at the same boundary.

The fix was to keep the surviving application session active with a zero-motion
heartbeat and to expire a server gameplay session after two seconds without
application activity. The focused checks then passed:

```text
✓ scripts/__tests__/run-networking-proof.spec.ts (4 tests)
✓ packages/core/__tests__/net.spec.ts (10 tests)
Tests 14 passed (14)

ok  threenative.local/networking-reference  0.004s
pnpm --filter threenative-native-smoke typecheck  # exit 0
```

## Live browser proof

Command:

```sh
node scripts/run-networking-proof.mjs \
  --config /tmp/networking-359-proof.json \
  --output /tmp/networking-359-proof-final7.json
```

Result: exit `0`, status `passed`, 19 evaluated assertions.

- Both real Chromium clients authenticated to `/game`; server logs observed
  `alpha` and `bravo` with distinct session IDs.
- Both clients reported `connected=true`, `peerObserved=true`, one accepted
  action, zero protocol errors, and remote motion (`1.40` metres maximum).
- The controlled partner loss reported `partnerExitCode=2`,
  `subjectExitCode=0`, `killMatchedCount=9`, `subjectPeerLost=true`, and
  `transportStillConnected=true`.
- Recorded build hashes were client
  `527b74b123a1513dc240635cce11283bf05b196c8a8ab711e33e4b8cf7c9747b` and
  server
  `a97f1f665b547f34d78792b61bb9d5ef6e3992626318bd7686bd6d1a9d64221d`.

The complete result JSON is retained locally at
`/tmp/networking-359-proof-final7.json`; the runner's redacted client/server
artifacts are under `/tmp/networking-proof/`. No native bridge or device claim
is made by this record.
