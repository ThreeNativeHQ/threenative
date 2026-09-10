# Dream Loop: target-driven authoring

Use this workflow when a user supplies a target image, asks for a target to be generated, or
wants to improve an existing game while preserving its identity. It is an explicit authoring
workflow, not a background scheduler. The builder edits the game; a fresh verifier reviews the
real capture; the two small generated scripts validate evidence and accounting.

## Upstream notice

This workflow adapts the mechanics of Dream Loop at revision
`9bddb901f7d071cfefdd21e264267c757177a9df` by Anshu Chimala:
https://github.com/achimala/dream-loop/tree/9bddb901f7d071cfefdd21e264267c757177a9df

Copyright (c) 2025 Anshu Chimala

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## 1. Lock the target and constraints

Start from the user's target. A supplied image takes precedence and needs no image-service key.
If no image is available, ask the user to choose an existing host image tool or explicitly opt in
to the generated `scripts/reference.mjs` route. Never invent a target or silently switch models.

Create one run directory under `.dream-loop/`, for example `.dream-loop/run-20260909-01/`, and
keep its `run.json`, prompt, target, captures, and verdicts together. Do not use a `current`
symlink as evidence. A run record is project-local and must contain at least:

```json
{
  "schemaVersion": 1,
  "runId": "run-20260909-01",
  "projectRoot": "/absolute/path/to/game",
  "artifactRoot": ".dream-loop/run-20260909-01",
  "builderIdentity": "builder-session-id",
  "currentSourceSha256": "sha256-of-current-source-or-dirty-tree",
  "target": { "path": ".dream-loop/run-20260909-01/target.png", "sha256": "...", "revision": 1 },
  "limits": {
    "startedAt": "2026-09-09T00:00:00.000Z",
    "deadlineAt": "2026-09-09T00:30:00.000Z",
    "maxRounds": 6,
    "maxImageRequests": 4
  },
  "requests": { "pending": [], "completed": [], "unknown": [], "failed": [] },
  "rounds": [],
  "decisionHistory": []
}
```

Record the original target bytes and hash. A user-authorized refinement creates a new target
revision and preserves the original target, prior scores, start time, and remaining allowance.
The builder cannot improve a score by replacing the target or by reviewing its own work.

## 2. Build and capture the real game

Read the existing capture, playtest, asset, and performance recipes. Search the engine capability
manifest before adding a mechanic or render stage. Keep appearance in the game's `src/render/`.
The target is a playable camera view: preserve the requested layout, controls, HUD, landmark,
and identity. A Blender render, a target image displayed over the canvas, or one frozen camera is
not a gameplay result.

For every round, store a capture record with the actual project-relative path and SHA-256,
target hash, source hash, viewport, deterministic input/scenario identity, adapter/platform,
and nonempty functional assertions. Store measured steady frame windows and a positive target
FPS bound. If display configuration is uncapped or the observation is missing, the round cannot
be accepted. Capture from a second gameplay position when the subject or asset is central to the
request.

## 3. Independent review and validation

Start the read-only verifier in a fresh context. Give it the target, current captures, request,
rubric, functional observations, and performance windows. It returns exactly `PASS`,
`REQUEST_CHANGES`, or `NOT_OBSERVED`; it does not receive the builder's self-assessment and it
must not edit the game. Scores are framing/composition 0–3, lighting/readability 0–3,
material/shape fidelity 0–3, and finish/HUD detail 0–1. The validator recomputes the total.
Gaps name visible locations and a proposed correction.

After the review, run:

```sh
node scripts/visual-loop.mjs --record .dream-loop/run-20260909-01/run.json
```

Exit 0 means the record was valid and a JSON decision was written; read its `decision`. It is
one of `continue`, `replan`, `accepted`, `stalled`, `budget-exhausted`, or `unavailable`.
Exit 2 means the record is malformed. A valid exit 0 is never acceptance by itself.

The validator refuses stale capture or target hashes, source changes, missing or empty
assertions, missing independent review, invalid score ranges, missing performance windows,
cross-run paths, symlink escapes, and a zero/uncapped FPS bound. It retains the best eligible
round and the latest gaps. Repeated gaps get one changed approach; if that replan does not
improve the result, the decision is `stalled`.

Acceptance requires a fresh capture, all functional assertions passing, a distinct critic,
`PASS`, a recomputed score of at least 8/10, no required blocker, and every measured performance
bound passing. Missing, interrupted, exhausted, and stalled runs are not accepted; they report
the best eligible evidence and the exact stop reason.

## 4. Optional OpenRouter target generation

Only use this route after the user has chosen it and `OPENROUTER_API_KEY` is present. The default
candidate is `meta/muse-image`; `--model` is an explicit override. The script qualifies the
selected model's advertised image input/output support, then uses one non-streaming chat request.
It does not retry, download a returned URL, forward credentials, or send unrelated project files.
Reference editing uses `--reference <local-image>` and includes the original screenshot bytes in
the request. If the model does not advertise the required capability, preserve the run and
report `unavailable` rather than substituting another endpoint or model.

```sh
node scripts/reference.mjs \
  --record .dream-loop/run-20260909-01/run.json \
  --request-id target-001 \
  --prompt-file .dream-loop/run-20260909-01/prompt.txt \
  --out .dream-loop/run-20260909-01/target.png \
  --model meta/muse-image
```

The script reserves the unique request ID and allowance under an exclusive run lock before its
one POST. It validates the deadline, response size, raster signature, dimensions where available,
MIME/extension agreement, and the atomic output. A completed ID returns its verified artifact;
pending or unknown IDs never POST again. A crash after dispatch remains pending and is reconciled
as unknown on resume. Usage or cost is recorded when returned, otherwise as `unknown`—never zero.
Errors name a safe category and HTTP status, and may include `Retry-After`; they never print the
authorization header or raw provider body.

## 5. Assets and release evidence

Use the existing asset/license and sculpt decision tree. For a bespoke landmark without a
reference, delegate to target acquisition first; do not invent a reference. Generated reference
images stay in authoring evidence, not the runtime build. Imported assets retain their returned
license and credits. Validate UVs, color space, normals, scale, floor contact, silhouette, and
multiple gameplay positions in browser and every actually executed native target.

Keep `.dream-loop/` ignored while the run is active. Promote the final target/captures, sanitized
request metadata, verdicts, and command output into a cited `docs/verification/` record before
cleanup. Never stage `.env`, `.env.authoring`, base64 payloads, scratch records, provider keys,
or upstream preview media. A missing host, provider, platform, or human visual result remains
`UNVERIFIED`; it does not become a green claim through a file-presence check.
