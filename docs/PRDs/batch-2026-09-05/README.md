# Three product priorities — September 5, 2026

**Status:** PARTIAL — execution started; no delivery PRD is accepted yet.

| Rank | Delivery PRD | What changes for the user | Existing owner |
| --- | --- | --- | --- |
| 1 | [360 — Android launch](PRD-360-android-launch-is-playable-within-eight-seconds.md) | Playable within 8 seconds, instead of the recorded 15–35-second startup. **PARTIAL**: measured on a Pixel 8 on 2026-09-07 at a preflight-qualified median 49,788.7 ms against the 8,000 ms criterion — unmet, and now an implementation gap rather than a missing measurement | PRD-339 / PRD-327 |
| 2 | [361 — Correct character setup](PRD-361-two-games-share-correct-character-setup.md) | Two real games stop rebuilding skeletal clone, scale and clip-validation plumbing | Authoring PRD-354 |
| 3 | [362 — Adaptive starter quality](PRD-362-starter-quality-adapts-to-measured-load.md) | The default game responds to measured load and preserves explicit overrides | PRD-287 |

Start 360 first. 361 can proceed independently of the phone lane; 362 uses that lane afterward.
Estimates are 6–10, 6–10 and 6–8 engineering hours respectively, plus build/device time.
“Today” means prioritize and start these delivery slices, not promise all three within one shift.

The underlying PRDs already exist. These new documents narrow the next shippable outcomes and
define integration, red/green proof and acceptance. Update the existing owners as slices land;
do not duplicate their mechanisms or mark their remaining scope complete.

Grounding: September 3 startup measurements, September 4 three-game character census, and current
starter quality/setup source. Historical measurements were not rerun. The original tooling-focused
drafts were replaced following the user's direction to prioritize product progress.

PRD-creator supplied the complexity assessment, live-caller ledgers, bounded phases and negative
controls. Execution evidence and remaining gates are in the
[batch ledger](../../verification/batch-2026-09-05-execution.md). Starter callback wiring has browser
red/green proof; physical-device performance acceptance and full delivery remain open.

Next action (under 2 minutes): open PRD-360 and read the 2026-09-07 device measurement.
