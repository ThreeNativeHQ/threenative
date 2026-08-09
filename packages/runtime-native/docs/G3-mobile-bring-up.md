# G3 — mobile bring-up

**Milestones:** M5, M6
**State:** Android emulator upstream cube PASS; iOS has no execution evidence.

## Android arrival evidence — 2026-08-08

- QuickJS + wgpu-native launched on the x86_64 emulator and packaged both required ABIs.
- Launch, exact marker, liveness, clean-log and screenshot gates passed for the upstream
  Three.js cube.
- That proof used runtime Three.js 0.182.0, while the workspace catalog is 0.185.1.
  Framework/catalog parity therefore remains OPEN.

## Open rows

- Unchanged core bundle for 300+ frames on Android at the exact catalog Three.js version.
- iOS simulator build, install, launch, unified logs and nonblank screenshot.
- Physical Metal/Vulkan driver behavior, arm64 physics and phone frame rate.

No row in this file permits a “mobile ready” claim while any open row remains.
