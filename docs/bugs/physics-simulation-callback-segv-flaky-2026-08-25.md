# The physics bridge segfaults intermittently at startup, on both sides of the batching fix

**Status:** open — newly observed 2026-08-25 during the render-projection device run; A/B-proven
pre-existing, so it does not block that fix's record
**Severity:** medium — kills the game roughly one launch in three, but every launch that survives
runs clean to a normal exit; flaky enough that earlier measurement sessions never met it
**Layer:** `packages/runtime-native` — `src/js/native_bindings.cpp` (physics simulation-object
callbacks) reached through `V8Engine::nativeCallback`
**Game used as the specimen:** `sandbox/fps-framework` (Bayview), `com.threenative.bayview`

## Symptom

Cold launch, SIGSEGV on `SDLThread` roughly 25–40 s in, while the scene is running:

```
Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0        # launch A: null call
Fatal signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0x75a11ef7d0  # launch B: bad access
  #00 pc 0000000000000000  <unknown>
  #01 libmystral-runtime.so 0x64fa74
      = std::__function::__func<mystral::physics::makeSimulationObject(...)::$_12, ...>::operator()
  #02 mystral::js::V8Engine::nativeCallback(v8::FunctionCallbackInfo<v8::Value> const&)+476
```

Two fault modes at the same dispatch site — a null function target once, an access violation
another time — is the signature of invoking a `std::function` whose target has been destroyed or
never set: the JS side calls a host API whose callback slot is dangling.

## Measured incidence (2026-08-25, same phone, same APK protocol)

| build | launches | crashed |
| --- | --- | --- |
| with material-keyed batch lane (`385fd50e`) | 4 | 2 |
| pre-fix core (`a3968785`, tarball `prefixa396-6303cecd99b0`) | 3 | 1 |

The pre-fix build crashes too, at the identical site. This filing exists so the crash is not
misattributed to the render projection — and so it stops hiding behind "ran fine last session".

## Not the bug

- **The material-keyed batch lane.** It touches only JS-side three.js scene preparation; it
  registers no host callbacks and no physics. The A/B table above is the evidence.
- **Thermal state.** Crashes landed on cool and warm launches alike.

## Next probe

Instrument `makeSimulationObject`'s callback registration/teardown in `native_bindings.cpp`:
log every `std::function` store and reset for simulation objects, reproduce across cold launches,
and find the path that destroys the target while V8 can still reach the trampoline. A bindings
test executable proves the contract without a display, per the PRD-166 precedent.
