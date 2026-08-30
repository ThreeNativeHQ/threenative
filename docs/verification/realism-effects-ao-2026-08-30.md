# Realism-effects ambient-occlusion coverage — 2026-08-30

Status: **not covered**.

The pinned workspace contains GTAO-related upstream nodes, but it does not contain an
`HBAOEffect` implementation or a runnable blind HBAO-versus-GTAO comparison fixture. This
record deliberately does not claim that `HBAOEffect` maps to GTAO. The coverage fixture keeps
that export as `not-covered` until both implementations can be rendered through the same camera,
scene, quality settings, and target lanes and judged without effect labels.

Required follow-up evidence:

- a source-backed HBAO implementation;
- matching HBAO and GTAO scenes and settings;
- blind web, desktop, and Android captures with the comparison result recorded here.

No platform result is counted for this row while the comparison is unavailable.
