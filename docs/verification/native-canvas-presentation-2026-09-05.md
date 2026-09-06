# Native canvas presentation regression

Wildwood exposed two engine defects on Linux desktop (V8, Dawn Vulkan, RTX 2080):

- The project bundler replaced native `document.createElement('canvas')` with the presentation canvas. Creating a 440×64 loading-status canvas resized the 1280×720 game surface and caused attachment-size validation failures.
- Independently created canvas contexts bypassed the surface-acquisition bookkeeping used by presentation. Their binding destination also needed an owned handle surviving the callback frame.

The bundler now preserves native canvas creation. Created WebGPU contexts use the same acquisition transaction as the host context and retain their binding destination.

## Red → green evidence

The prelude regression failed with `a text canvas must not alias the presentation canvas`, then passed after removing the alias. A raw native two-canvas probe produced no screenshot and exited 1 before the presentation fix; afterward it produced an inspected 1280×720 green frame and exited 0.

The strengthened `90-document-window-stubs` conformance case renders through a newly created canvas while sizing an independent text canvas. Its executed desktop report contains **1 pass, 0 fail, 92 blocked**: only the selected case was run; this is not a full parity result. The inspected output contains the expected green card and blue ring.

The prelude unit is collected by root `pnpm test`. The conformance case is already selected by the existing native desktop-parity CI lane; no new advisory-only workflow is needed to exercise it.

Local detailed evidence: `artifacts/wildwood-native-profile-20260905/` (`probe-before.log`, `probe-green.log`, `probe-green.png`, and `conformance/report.json`). These local artifacts are not a claim of browser, Android, or iOS execution.

Wildwood scene quality, pointer capture, UI attachment, and steady-state performance are separate checks and are not established by this canvas regression.
