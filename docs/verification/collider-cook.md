# PRD-252 collider-cook verification

Run date: 2026-08-29. Worktree: `feature-mining-prd252-20260829` at
`a1d673b87766ba6cda5c180014999e070d9e9124`.

## Provenance gate

The acquired tool is the upstream `coacd` 1.0.11 Python wheel for Linux x86-64. It was installed
into a fresh temporary virtual environment, not into the repository or any shipped package.

| Field | Observed value |
| --- | --- |
| Upstream | `SarahWeiii/CoACD`, release 1.0.11 (`b678aa0`) |
| Licence | MIT; upstream `LICENSE`, copyright 2022 Xinyue Wei and Minghua Liu |
| Wheel | `coacd-1.0.11-cp39-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl` |
| SHA-256 | `a60f700a52e5b40462e508c14bb756cd63ce7e6a95ff72ae0b1592be1dbb0106` |
| Host executed | `Linux 7.1.4-1-cachyos x86_64` |
| Other tool hosts | macOS and Windows advertised upstream; **UNVERIFIED here** |

The wheel metadata itself reported `Name: coacd`, `Version: 1.0.11`, and `License: MIT`.

## Actual CLI surface

`coacd --help` executed after installing its declared runtime requirement plus `trimesh`. Relevant
flags, copied from the executable rather than inferred from the PRD:

```text
-i, --input INPUT
-o, --output OUTPUT
-t, --threshold THRESHOLD
-pm, --preprocess-mode PREPROCESS_MODE
-r, --resolution RESOLUTION
-nm, --no-merge
-d, --decimate
-dt, --max-ch-vertex MAX_CH_VERTEX
-c, --max-convex-hull MAX_CONVEX_HULL
-mi, --mcts-iteration MCTS_ITERATION
-md, --mcts-max-depth MCTS_MAX_DEPTH
-mn, --mcts-node MCTS_NODE
-pr, --prep-resolution PREP_RESOLUTION
--pca
-am, --apx-mode APX_MODE
--seed SEED
```

The Python API signature additionally exposes `real_metric: bool = False`; the installed 1.0.11 CLI
does **not** expose the upstream README's `-rm/--real-metric` flag. The collider pass must therefore
use the pinned Python API for real-metric thresholds or refuse that option by name. It must not pass
an unsupported CLI flag.

## Required-capability verdict

| Required capability | Evidence | Verdict |
| --- | --- | --- |
| MIT-compatible licence | upstream licence plus wheel metadata | verified |
| Fixed-seed determinism | executable `--seed`; output reproducibility still needs the real subject | surface verified, behaviour **UNVERIFIED** |
| Hull-count cap | executable `--max-convex-hull` | verified |
| Per-hull vertex cap | executable `--decimate --max-ch-vertex` | verified |
| Non-manifold preprocessing | executable `--preprocess-mode` and `--prep-resolution` | surface verified, real subject **UNVERIFIED** |
| Real-metric threshold | Python API only, absent from installed CLI | verified boundary |
| Linux execution | wheel installed and CLI help executed | verified |
| macOS / Windows execution | no exact host executed | **UNVERIFIED** |

## Commands executed

```sh
python3 -m venv /tmp/tn-coacd.M2kIZc/venv
/tmp/tn-coacd.M2kIZc/venv/bin/pip install coacd==1.0.11 trimesh
/tmp/tn-coacd.M2kIZc/venv/bin/coacd --help
/tmp/tn-coacd.M2kIZc/venv/bin/python -c 'import coacd, inspect; print(inspect.signature(coacd.run_coacd))'
/tmp/tn-coacd.M2kIZc/venv/bin/pip download --no-deps --dest /tmp/tn-coacd.M2kIZc/download coacd==1.0.11
sha256sum /tmp/tn-coacd.M2kIZc/download/*
```

No cooker source or binary was copied into the repository. No runtime package gained a dependency.

## Real-subject reproducibility gate

The shipped asset MCP selected Poly Haven's CC0 **Modular Fort 01**: 28,218 polygons with a real
arched gate. The 1K glTF and geometry buffer were downloaded after acknowledging CC0. Source SHA-256:

- `modular_fort_01_1k.gltf`: `829ac97d4c5c5672d3055d772e0ef4b545ad93cb4b639296f34e3ddf04cf9faf`
- `modular_fort_01.bin`: `de86e71af4cd5b37006914a8e7ae7de59b245b73364317f1886285a6aa797f57`

Three identical cooks used `-t 0.05 -pm auto -c 32 -d -dt 64 --seed 42 --quiet`. The first two
took 15 and 14 seconds. Fixed seed did not reproduce either bytes or canonicalized geometry:

| Run | Parts | Vertices | Canonical geometry SHA-256 |
| --- | ---: | ---: | --- |
| A | 32 | 2,001 | `78cecbeff23b17b373b834cb3c1bb6fcfc9787abee64d5368eed160a4786d49c` |
| B | 31 | 1,938 | `3e8caf6182f997fd6053806eaa0f994ed4f0161b5bad56b83b9734942e75b0ed` |
| C | 32 | 2,020 | `ebe1bd9558f9cafe44a6b0190c403aecfb637280003a0f34594adcc9bdd283f0` |

Raw output A/B also failed byte comparison (`cmp_exit=1`). Canonical hashes sort per-part hashes,
so emission order cannot explain the difference. The actual part sets differ.

This triggers PRD-252's stated kill condition: cooked artifacts cannot carry a reproducible identity.
No pass, runtime shape, template binary, or package dependency was added. Browser/native playtests and
sandbox validation are **NOT RUN** because the Phase 1 gate refused the capability before one existed.
