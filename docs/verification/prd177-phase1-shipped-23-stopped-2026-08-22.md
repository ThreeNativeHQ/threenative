# PRD-177 — phase 1 shipped, phases 2–3 stopped at their own negative control

Date: 2026-08-22
Lane: `lane-native`
Status: **PHASE 1 LANED (commit f2b70c34); PHASES 2–3 NOT SHIPPED — negative control cannot fire**

## Phase 1 — document/window listener removal is real

`runtime.cpp` routed window removal (was an unconditional `return newUndefined()`) and document
removal (loop body empty, "we don't properly compare", minting a spurious map entry per failed
removal) through the existing `removeEventListenerFromTarget` identity-compare path — the same
mechanism canvas already used. No second mechanism invented.

Red, pre-fix (`tests/input_restart_test.cpp`, two register→dispose cycles on window and document):

```text
[error] [input-restart] window delivered 3 events across two register-dispose cycles (want 2):
first:KeyA,first:KeyA,second:KeyA; window second delivery was first:KeyA, the disposed listener
must not ghost; document delivered 3 events across two register-dispose cycles (want 2):
first,first,second
FAILED: input delivered to disposed listeners after restart, exit 1   # exit=1
```

Green post-fix: `[input-restart] two register-dispose cycles delivered each event exactly once`,
exit=0. Mutation: commenting exactly the unprotect+erase lines inside
`removeEventListenerFromTarget` reproduced both ghostings verbatim (exit=1); restored → exit=0.

Conformance row `97-input-restart-lifetime` + scene `conformance/scenes/shared/input-restart-lifetime.js`
are committed; **the row has not been executed yet** — `run-conformance.mjs` registers into the
parity-phase worktree lease, which other lanes hold continuously today. Execution is owed before
PRD-177's criterion 1 can claim its paste. `pnpm gate:doctor` shows the lease state at any moment.

## Phases 2–3 — stopped by their own negative control

The PRD demands: *"revert to clear-after-close → intermittent red within 50 runs (**if 50 runs
stay green on the reverted code, STOP — the hazard model is wrong, report back instead of
shipping**)."* HEAD before this lane's commits IS clear-after-close, so the reverted-code arm ran
against unfixed source with `tests/shutdown_lifetime_test.cpp`:

- `http` mode — keep-alive request in flight (local hanging listener holds a real connection,
  socket polls registered and verified pending) when teardown cancels and closes.
- `timer-watch` mode — live `setInterval` plus a registered fs_event watch through ten pumped
  frames, then full `RuntimeImpl::shutdown()` → `EventLoop::shutdown()` drain.

Results:

```text
timer-watch: 0 red of 50
http:        0 red of 50
```

A glibc amplifier probe (`MALLOC_PERTURB_=53`, five runs per mode) also stayed green: 0/10.

### Why the red cannot fire here (hazard model assessment)

The defect named by the PRD is real in the code: contexts owning `uv_poll_t`/`uv_timer_t`/
`uv_fs_event_t` by value are freed by `sockets.clear()` / `uvTimers_.clear()` /
`watches.clear()` after `uv_close` but before `EventLoop::shutdown()`'s drain walks those same
handles. But on this platform the failure is **invisible to exit codes at minimal-process scale**:

1. Modern glibc's tcache preserves freed chunk bytes unperturbed — `MALLOC_PERTURB_` does not
   cover tcache-recycled small chunks — so every stale read/write during the drain sees coherent
   old values and behaves correctly.
2. Between free and drain almost nothing allocates, so the chunks are rarely reused mid-drain;
   production heap pressure is what makes this intermittent, and a minimal test process has none.
3. The detectors that would see it are unavailable: valgrind is not installed on this machine;
   ASan would need libuv itself instrumented and libuv ships only as a prebuilt `.a`
   (`third_party/libuv`, "Prebuilt layout" in CMakeLists.txt) whose sanctioned reconstruction
   path does not include a source build.

Shipping phases 2–3 now would mean landing a fix that nothing in this tree can turn red — exactly
the unfalsifiable-fix outcome the stop clause exists to prevent. The close-callback ownership
pattern to use when this unblocks is already proven in-tree (`async_http_client.cpp` POLL_REMOVE
path, `clearAllTimers()`/`onTimerClose`) and is recorded in the PRD's integration ledger.

### What unblocks it

An ASan lane that instruments libuv (source build added to `scripts/download-deps.mjs` or a
CMake `add_library` from vendored sources) makes the write-after-free deterministic red within a
handful of runs; then the N=50 green discipline runs as written. Filed as the named follow-up the
PRD's out-of-scope section anticipated ("if the native build has no ASan configuration … record
ASan wiring as a named follow-up").

## Scoped gates

```text
threenative-input-restart-test          # exit 0 (green), exit 1 on mutation
threenative-dom-dispatch-lifetime-test  # exit 0 (regression)
pnpm census                             # re-tied in f2b70c34
```
