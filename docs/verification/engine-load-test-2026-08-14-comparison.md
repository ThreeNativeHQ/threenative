## tn-web vs godot-web

Product-to-product. Each arm is what that engine actually ships to this surface; the two run
different rendering backends by construction and no line below is a graphics-API claim.

| mode | knee — tn-web | knee — godot-web |
|---|---|---|
| L1 | 1024 | 4096 |
| L2 | 16384 | 4096 |

| mode | N | tn-web p95 ms | godot-web p95 ms | ratio |
|---|---|---|---|---|
| L1 | 256 | 2.60 | 1.84 | 1.41× |
| L1 | 1024 | 9.30 | 5.94 | 1.57× |
| L1 | 4096 | 34.10 | 19.29 | 1.77× |
| L1 | 16384 | 116.40 | 63.69 | 1.83× |
| L2 | 256 | 2.30 | 1.03 | 2.22× |
| L2 | 1024 | 2.70 | 2.72 | 0.99× |
| L2 | 4096 | 2.00 | 7.14 | 0.28× |
| L2 | 16384 | 8.10 | 27.36 | 0.30× |

### Arm `tn-web`

- engine: threenative workspace
- build: release — vite dev build, three/webgpu render path as ThreeNative ships it; defineGame loop not in the measured path
- driver: three/webgpu WebGPURenderer
- adapter: nvidia / turing
- device: desktop-chrome-linux, 1280×720 @ 60 Hz, vsync off

| mode | N | p50 ms | p95 ms | draws | tris | visible | repeats × samples |
|---|---|---|---|---|---|---|---|
| L1 | 256 | 1.50 | 2.60 | 164 | 1947 | 163 | 3 × 480 |
| L1 | 1024 | 5.20 | 9.30 | 629 | 7527 | 628 | 3 × 480 |
| L1 | 4096 | 21.90 | 34.10 | 2469 | 29607 | 2468 | 3 × 480 |
| L1 | 16384 | 96.40 | 116.40 | 9809 | 117687 | 9808 | 3 × 480 |
| L2 | 256 | 1.20 | 2.30 | 3 | 3075 | 256 | 3 × 480 |
| L2 | 1024 | 1.30 | 2.70 | 3 | 12291 | 1024 | 3 × 480 |
| L2 | 4096 | 1.20 | 2.00 | 3 | 49155 | 4096 | 3 × 480 |
| L2 | 16384 | 5.20 | 8.10 | 3 | 196611 | 16384 | 3 × 480 |

**Knee at ≤ 20 ms p95** — L1: 1024, L2: 16384

### Arm `godot-web`

- engine: godot 4.7.1-stable (official)
- build: release — godot export, rendering method read from the engine at runtime
- driver: gl_compatibility / opengl3
- adapter: WebKit WebGL / OpenGL ES 3.0 (WebGL 2.0 (OpenGL ES 3.0 Chromium))
- device: Web GenericDevice, 1280×720 @ 60 Hz, vsync off

| mode | N | p50 ms | p95 ms | draws | tris | visible | repeats × samples |
|---|---|---|---|---|---|---|---|
| L1 | 256 | 1.29 | 1.84 | 171 | 2042 | 171 | 3 × 480 |
| L1 | 1024 | 3.66 | 5.94 | 658 | 7886 | 658 | 3 × 480 |
| L1 | 4096 | 13.37 | 19.29 | 2582 | 30974 | 2582 | 3 × 480 |
| L1 | 16384 | 54.20 | 63.69 | 10246 | 122942 | 10246 | 3 × 480 |
| L2 | 256 | 0.70 | 1.03 | 2 | 3074 | 2 | 3 × 480 |
| L2 | 1024 | 1.70 | 2.72 | 2 | 12290 | 2 | 3 × 480 |
| L2 | 4096 | 5.08 | 7.14 | 2 | 49154 | 2 | 3 × 480 |
| L2 | 16384 | 19.49 | 27.36 | 2 | 196610 | 2 | 3 × 480 |

**Knee at ≤ 20 ms p95** — L1: 4096, L2: 4096
