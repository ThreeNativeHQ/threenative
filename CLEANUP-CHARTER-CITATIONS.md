Repo: /home/joao/projects/threejs-webgpu

# Task: remove charter section-number citations from the live docs

`AGENTS.md` now carries this rule (added 2026-08-11). Apply it to the files listed below.

> **Never cite the charter by section in a doc you write.** No `**Charter authority:** §3, §7`
> headers, no "per `CHARTER.md` §5b", no "§12 criterion 3". Nobody has the section numbers
> memorised, so a reader hits a lookup instead of a fact, and most of those citations are
> decoration anyway. **State the rule itself in one plain clause** — "gameplay is permanently
> the user's to write", "no stranger has played a ThreeNative game for five minutes yet". Name
> `CHARTER.md` at most once per document, without a section number, and only when a reader who
> disagrees would genuinely need to go read it. The same applies to status boilerplate: a date
> and one line of what the file is beats a block of authority declarations.

## How to do it

1. Read `docs/architecture/CHARTER.md` ONCE, up front, so you know what each § actually says.
   You need its content to replace a citation with the rule it points at.
2. For each `§` occurrence, replace the citation with the rule stated in plain words. Do not
   just delete it — the sentence must still carry the constraint. Examples already applied in
   `AGENTS.md`, `docs/strategy/ROADMAP.md` and `docs/strategy/VALUE-PROPOSITION.md`; read those
   three as the reference style before starting.
   - `CHARTER.md §5b permanently assigns gameplay to the user` → `gameplay is permanently the
     user's to write`
   - `CHARTER.md §12 criterion 3` → `no stranger has played a ThreeNative game for five minutes`
   - `` `CHARTER.md` §7 device matrix `` → `the device matrix`
   - `**Charter authority:** CHARTER.md §3, §7 — it wins if this file disagrees.` → delete the
     header; if the file genuinely needs it, one plain line: `The charter wins wherever this
     file disagrees with it.`
3. Change nothing else. No rewording of surrounding prose, no restructuring, no fixing of
   unrelated staleness. This is one mechanical pass.
4. **Never change a claim's truth value.** If a sentence says a criterion is unmet, blocked or
   UNVERIFIED, it still says that afterwards.

## Do NOT touch

- `docs/architecture/CHARTER.md` — it is the source document; its own § numbering stays.
- `docs/PRDs/done/**` and `docs/PRDs/native/done/**` (52 files, 509 hits) — archived evidence
  records. Leave them as historical artifacts.
- `docs/verification/**` (3 files, 13 hits) — same reason.
- Anything under `.worktrees/`.

## Files to change — 26 files, 109 occurrences

| Hits | File |
|---:|---|
| 15 | docs/strategy/CONFLICTS.md |
| 11 | docs/architecture/THREEJS-CONSTRAINTS.md |
| 9 | docs/strategy/NATIVE-LEVELS-2026-08-08.md |
| 7 | docs/spikes/0a-mobile-render.md |
| 6 | docs/PRDs/PRD-064-tier-1-native-reliability.md |
| 6 | docs/PRDs/PRD-045-playtest-on-device.md |
| 5 | docs/product/ASSET-PIPELINE.md |
| 5 | docs/PRDs/PRD-061-round-4-paired-capability-proof.md |
| 5 | docs/PRDs/OPPORTUNITY-AREAS.md |
| 5 | docs/architecture/ENTITY-MODEL.md |
| 4 | docs/strategy/POSITIONING.md |
| 4 | docs/strategy/METRICS.md |
| 4 | docs/product/PERFORMANCE-BUDGETS.md |
| 4 | docs/architecture/AGENT-INTERFACE.md |
| 3 | docs/strategy/BUSINESS-MODEL.md |
| 3 | docs/PRDs/native/README.md |
| 3 | docs/benchmark/PROTOCOL.md |
| 2 | docs/PRDs/PRD-065-ios-evidence-lane.md |
| 1 | docs/PRDs/native/blocked/README.md |
| 1 | docs/PRDs/native/blocked/PRD-056-physical-mobile-qualification.md |
| 1 | docs/PRDs/native/blocked/PRD-055-native-hud-reopened.md |
| 1 | docs/PRDs/native/blocked/PRD-054-write-once-run-anywhere.md |
| 1 | docs/PRDs/batch-2026-08-10/README.md |
| 1 | docs/benchmark/RESULTS-TEMPLATE.md |
| 1 | docs/benchmark/RESULTS-2026-08-02.md |
| 1 | docs/architecture/NATIVE-RUNTIME.md |

## Done when

```sh
# returns nothing except CHARTER.md, done/ PRDs and verification/
grep -rn '§' docs | grep -vE 'architecture/CHARTER\.md|PRDs/(done|native/done)/|/verification/'

pnpm lint          # must stay green
pnpm sync:agents --check   # must stay in sync
```

Also confirm no markdown link broke: every `](...)` path in a file you edited still resolves.
