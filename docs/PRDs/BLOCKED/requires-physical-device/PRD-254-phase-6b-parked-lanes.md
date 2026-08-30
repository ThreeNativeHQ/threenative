# PRD-254 Phase 6B — three parked lanes remain

**Status:** BLOCKED
**Filed:** 2026-08-28 by the PRD-254 landing
**Missing evidence:** a physical Pixel 8 for three remaining lanes.

PRD-254 Phase 6B said these lanes must be landed or filed, and that "still sitting in a
worktree" is not an acceptable end state. Three remain live and need device evidence. Four other
rows are retained below as adjudication history: one unsafe change was rejected and three stale
branches were superseded by newer implementations already on `main`. None was auto-merged,
because Phase 6B says landing them is a separate decision per lane and this PRD's scope is
explicitly *no new engine behaviour*.

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
| `codex/hostgap-instrumentation` | `3712f3db` | 7 | **ALREADY LANDED by the newer `73e0baec` + `6502502c` host-side meter; isolated native audit passed 2026-08-30** | PRD-226 remains open for its ablation ladder | Closed; do not replay the stale implementation. See `runtime-perf-state.md` |
| `worktree-agent-a15fb02a370974a26` | `0b3f230d` | 4 | **ALREADY LANDED exactly by squash `31cba321`; detached tarball audit passed 2026-08-30** | PRD-214 remains PARTIAL for later optimization phases | Closed; do not replay the stale history. See `runtime-perf-state.md` |
| `worktree-agent-a5310592192d978ec` | `e5d46a9b` | 1 | **REJECTED 2026-08-30:** lifetime-held V8 entry repeatably segfaults the production worker contract; main's same-build control passes | PRD-227 open | Closed; do not retry. See `prd-254-v8-lifetime-rejection-2026-08-30.md` |
| `worktree-agent-a60b0b3f74d66bb64` | `3fbc926a` | 3 | tombstone/crash-handler proof on the phone, and a resume defect it exposed | — | A physical Pixel 8 |
| `worktree-agent-a78ac559a62314fcf` | `ec31e840` | 1 | **ALREADY LANDED:** equivalent implementation is on main at `5ebebd95`; detached packed-tarball audit passed 2026-08-30 | — | Closed; do not replay the stale commit. See `prd-254-mobile-decoder-audit-2026-08-30.md` |
| `worktree-agent-a868a44e113b83123` | `2f6b2fc0` | 1 | PRD-213 Pixel 8 GPU-memory attribution and published ceiling | PRD-213 open in `mobile/` | A physical Pixel 8 to re-measure, or acceptance of the recorded numbers |
| `worktree-prd-222-resume` | `53101a12` | 3 | config-change axes so mid-play changes stop killing the process | PRD-222 open | A physical Pixel 8; the emulator artifacts are already in the branch |

The eighth Phase 6B lane, `worktree-agent-a5019321d7ca9cf88` (PRD-209 portable text,
docs only, one file), **was landed** — it carried no code and therefore no gate risk. The V8,
mobile-decoder, host-gap and frame-budget rows above are historical adjudications and are no longer
blocked work; three live rows remain.

## The Pixel 8 lane's own quirks, for whoever picks these up

Recorded so the next attempt does not rediscover them: the device trips thermal `LIGHT`
between first-proof launch and preflight, so cool to ≤31.5 °C and retry, and the battery
floor bites after roughly four to six rungs.
