# PRD-254 Phase 6B — the seven parked lanes

**Status:** BLOCKED
**Filed:** 2026-08-28 by the PRD-254 landing
**Missing evidence:** a physical Pixel 8 for five of the seven, and a dedicated gated
landing for the two that are desktop-provable.

PRD-254 Phase 6B said these lanes must be landed or filed, and that "still sitting in a
worktree" is not an acceptable end state. None of them is dead: each has commits absent
from `main` and an open PRD behind it. None was auto-merged, because Phase 6B says
landing them is a separate decision per lane and this PRD's scope is explicitly *no new
engine behaviour*.

**What was done instead:** every tip is archived under
`refs/archive/branches-2026-08-28/`, every branch is kept, and every worktree's dirty
state was snapshotted to `/home/joao/threenative-worktree-archive-2026-08-28/` before the
worktrees were removed. The work is recoverable by branch name; only the checkouts are
gone.

**The blocked reason was tried before it was believed.** `adb devices -l` runs from
`/home/joao/Android/Sdk/platform-tools/adb` and reports `List of devices attached` with
no device. The device lanes below cannot be proven right now, and no Android result is
claimed for any of them.

| Lane branch | Tip | Ahead of `main` | Carries | PRD | What unblocks it |
|---|---|---|---|---|---|
| `codex/hostgap-instrumentation` | `3712f3db` | 7 | host-gap accounting reconciled with the frame budget, plus a rejected-experiment record; `packages/core` + `packages/runtime-native` | PRD-226 open | Its own gated landing. Desktop-provable — desktop A/Bs read `render.p50`, never fps |
| `worktree-agent-a15fb02a370974a26` | `0b3f230d` | 4 | a frame budget that names where a presented frame went, and a playtest budget gate; 39 files | PRD-214 open | Its own gated landing; the mobile half needs a device |
| `worktree-agent-a5310592192d978ec` | `e5d46a9b` | 1 | F13 step 1 — hold the V8 isolate/context for the engine lifetime. **Absent from `main`** | PRD-227 open | A native build plus a measured before/after. Highest-value lane of the seven |
| `worktree-agent-a60b0b3f74d66bb64` | `3fbc926a` | 3 | tombstone/crash-handler proof on the phone, and a resume defect it exposed | — | A physical Pixel 8 |
| `worktree-agent-a78ac559a62314fcf` | `ec31e840` | 1 | keep three's WASM decoders out of the mobile bundle | — | Its own gated landing; the bundle assertion is desktop-provable |
| `worktree-agent-a868a44e113b83123` | `2f6b2fc0` | 1 | PRD-213 Pixel 8 GPU-memory attribution and published ceiling | PRD-213 open in `mobile/` | A physical Pixel 8 to re-measure, or acceptance of the recorded numbers |
| `worktree-prd-222-resume` | `53101a12` | 3 | config-change axes so mid-play changes stop killing the process | PRD-222 open | A physical Pixel 8; the emulator artifacts are already in the branch |

The eighth Phase 6B lane, `worktree-agent-a5019321d7ca9cf88` (PRD-209 portable text,
docs only, one file), **was landed** — it carried no code and therefore no gate risk.

## The Pixel 8 lane's own quirks, for whoever picks these up

Recorded so the next attempt does not rediscover them: the device trips thermal `LIGHT`
between first-proof launch and preflight, so cool to ≤31.5 °C and retry, and the battery
floor bites after roughly four to six rungs.
