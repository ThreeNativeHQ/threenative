# Blocked PRDs

This folder contains PRDs whose status is explicitly `BLOCKED`. Each reason folder names the
missing evidence, external capability, review outcome, or failing gate that prevents closure.
`NOT STARTED`, `PARTIAL`, `OPEN`, and `PROPOSED` PRDs stay in their owning batch even when a
dependency is not ready.

| Reason | PRDs | What unblocks it |
|---|---|---|
| [`requires-parity-rerun/`](requires-parity-rerun/) | [PRD-054](requires-parity-rerun/PRD-054-write-once-run-anywhere.md) | A clean, non-blocked cross-platform parity run |
| [`requires-touch-evidence/`](requires-touch-evidence/) | [PRD-055](requires-touch-evidence/PRD-055-native-hud-reopened.md) | Android touch-playability evidence |
| [`requires-physical-device/`](requires-physical-device/) | [PRD-056](requires-physical-device/PRD-056-physical-mobile-qualification.md) | Named physical Android/iOS devices, signed artifacts, and Apple credentials |
| [`review-cap/`](review-cap/) | [PRD-057](review-cap/PRD-057-native-audio-parity.md), [PRD-160](../done/PRD-160-android-emulator-lane-repair-and-parity-adjudication.md) | Specification reopen after the review cap; for PRD-160, an owner-approved parity run that reaches pixel comparison |
| [`requires-physical-proof/`](requires-physical-proof/) | [PRD-058](requires-physical-proof/PRD-058-performance-reliability-observability.md) | Current-candidate physical evidence and marker-control repair |
| [`requires-release-credentials/`](requires-release-credentials/) | [PRD-060](requires-release-credentials/PRD-060-promoted-consumer-distribution.md) | Release, registry, and platform-signing credentials plus prerequisite evidence |
| [`requires-ray-measurement/`](requires-ray-measurement/) | [PRD-088](requires-ray-measurement/PRD-088-physics-spatial-queries.md) | Authoritative pre-implementation ray measurement |
| [`requires-packed-gate/`](requires-packed-gate/) | [PRD-112](requires-packed-gate/PRD-112-golden-path-from-packed-artifacts.md), [repair](requires-packed-gate/PRD-112-repair-golden-path-contract.md) | Green packed seven-template gate |
| [`requires-sealed-proof/`](requires-sealed-proof/) | [PRD-113](requires-sealed-proof/PRD-113-sealed-brief-naming-contract.md), [repair](requires-sealed-proof/PRD-113-repair-sealed-behavior-proof.md) | Positive behavior-based sealed proof |
| [`requires-hosted-run/`](requires-hosted-run/) | [PRD-059](requires-hosted-run/PRD-059-native-dependency-provenance-sbom.md), [PRD-078](requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md) | One release run with all five build legs green. PRD-078's own subject — the missing Vulkan ICD — is fixed and the desktop core gate now passes on the runner; three unrelated legs fail |
| [`requires-external-person/`](requires-external-person/) | [PRD-080](requires-external-person/PRD-080-five-minute-stranger-test.md) | One person who has not seen this project, playing for as long as they choose, recorded with consent. The protocol is written and the experiment is defined once; nothing else here produces a stranger |
| [`requires-evdev-delivery/`](requires-evdev-delivery/) | [PRD-077](requires-evdev-delivery/PRD-077-desktop-multitouch-injector.md) | A host that delivers a kernel input device to the window under test: this user in the `input` group, or the desktop lane on a seated X server instead of Xvfb. The injector itself is built and proved to the kernel boundary |

Moved on 2026-08-15. The old `docs/PRDs/native/blocked/README.md` remains as a native-lane
compatibility pointer; no PRD files remain there.
