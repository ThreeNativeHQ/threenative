# PRD-091 Phase 0 — template gate fails open

Recorded 2026-08-12 before the registry change.

The baseline gate was run with an unregistered directory temporarily added at
`packages/create-threenative/templates/phase0-unregistered-broken/`. The directory was a copy of
the existing `platformer` template with `src/render/postprocessing.ts` removed. No TypeScript
allowlist or gate list was changed. The fixture was removed after the run.

Command:

```sh
pnpm test:templates
```

Observed result:

```text
minimal: scaffolded playtests passed.
starter: scaffolded playtests passed.
platformer: scaffolded playtests passed.
exit=0
```

The output contains no observation of `phase0-unregistered-broken`, and the process exited zero.
This is the recorded green-before state: a broken template on disk was outside the hardcoded
enumeration and therefore escaped the gate.
