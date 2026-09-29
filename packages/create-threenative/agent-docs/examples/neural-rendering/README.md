# Experimental neural rendering: safety foundation

**This is not a working neural renderer or a DLSS integration.** These optional, editable
TypeScript modules implement the first safety-policy slice of PR #380. There are no model
weights, reviewed inference shaders, GPU bridge, provider adapter, or sandbox UI here yet.

The source lives in the package's existing `agent-docs` bundle, not in ordinary templates.
For an opt-in experiment, copy the three `.ts` files from
`node_modules/create-threenative/agent-docs/examples/neural-rendering/` into the generated
game's `src/render/neural/`. They use relative imports and standard ECMAScript only. No package
exports or default game imports have been added. Installed-consumer verification is still pending.

## Model and device preflight

`validateNeuralManifest(raw, layout)` accepts a version-1, data-only manifest with the exact
provider, full source revision, graph, and stage lengths supplied by reviewed provider code.
Stages contain only `path`, `bytes`, and lowercase `sha256`. Canonical relative `.bin` keys
are accepted; URLs, traversal, encoded paths, duplicate stages, and executable extensions
are rejected. The returned copy is frozen and ordered by the reviewed layout.

`verifyNeuralStage(stage, bytes, sha256)` checks exact length before invoking the caller's
platform SHA-256 implementation, then checks the digest. Hash matching proves integrity
against the supplied manifest, **not authenticity, authorization, or redistribution rights**.
The future loader must obtain an authorized manifest, bound downloads, enforce approved
origins and redirects, support cancellation, and supply immutable verified bytes to the adapter.
Do not execute shader or module URLs from model metadata. Nothing here downloads a model.

`planNeuralInput(request, device, requirements)` validates the actual renderer **device's**
features and limits, pads provider dimensions, and checks an explicit incremental byte cap
against the trusted provider's peak estimate. It separately checks texture dimensions,
individual buffers, and storage-binding limits. This first-smoke policy caps valid input at
512 pixels per axis. Working dimensions may be larger after padding and are reported separately.
The estimator must include weights, repacking, activations, staging, and both history/output
sets; this helper cannot validate the estimator's accounting or discover free VRAM.

## Frame identity and resource retirement

`NeuralFrameGate` starts disabled. Enable it explicitly, request source frame IDs, and call
`begin(renderedFrameId)` only after encoding that matching source pass. It admits one active
ticket and retains only the newest pending **identity**, never borrowed live textures.
Generation changes invalidate late results without pretending already-submitted work stopped.
History is valid only for consecutive successfully completed source frames; skipped frames reset it.

Call `complete(ticket, succeeded)` only after GPU work has retired, or after a failure that
occurred before any work was submitted. A rejected provider promise is not a retirement fence.
A true return authorizes that result identity; it does not prove texture provenance, GPU
completion, color correctness, or current-frame render/compute/composite order. The future bridge
must establish those facts and retain a coherent original/enhanced capture pair. Publish frozen
or aged results honestly rather than comparing them against an unrelated live frame.

`NeuralResourceScope` tracks borrowed and individually owned allocations separately. Register
the renderer device, queue, source textures, and shared model as borrowed. Register only
allocations whose `destroy()` frees that allocation without touching borrowed resources.
**Never register the upstream `Network.destroy()` convenience destructor.** It has not been
patched or integrated here, and its ownership behavior cannot be made safe by renaming it.

`retireAfter(fence)` closes registration immediately and destroys owned allocations once the
safe fence fulfills. A rejected fence retains them and allows retry with a confirmed-safe fence.
Repeated retirement is idempotent; one cleanup exception does not skip other allocations.
The renderer/adapter, not this policy class, must produce the real queue-completion or
confirmed-device-loss fence. No device acquisition or recovery is attempted here.

## Proof and remaining work

The package tests are `neural-provider-contract.spec.ts` and `neural-render-lifecycle.spec.ts`
under `packages/create-threenative/__tests__/`. Run them with the repository's Vitest command.
The PRD records what was actually executed; a pure policy test does not qualify a GPU path.

Remaining work includes the same-device GPU fixture and ordered composition, an independently
safe pinned OpenDLSS-NR adapter, bounded loading and cancellation, model qualification,
photo-mode comparison UI, and installed browser/Linux-native playtests. Keep the experiment
out of ordinary rendering defaults until that work is demonstrated. A deterministic integration
fixture must be labeled as a fixture, never as neural enhancement.
