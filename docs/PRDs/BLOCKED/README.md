# Blocked PRDs

This folder contains PRDs whose status is explicitly `BLOCKED`. Each reason folder names the
missing evidence, external capability, review outcome, or failing gate that prevents closure.
`NOT STARTED`, `PARTIAL`, `OPEN`, and `PROPOSED` PRDs stay in their owning batch even when a
dependency is not ready.

| Reason | PRDs | What unblocks it |
|---|---|---|
| [`requires-ios-simulator/`](requires-ios-simulator/) | [PRD-045](requires-ios-simulator/PRD-045-playtest-on-device.md) | Two consecutive green hosted iOS-simulator runs |
| [`requires-parity-rerun/`](requires-parity-rerun/) | [PRD-054](requires-parity-rerun/PRD-054-write-once-run-anywhere.md) | A clean, non-blocked cross-platform parity run |
| [`requires-touch-evidence/`](requires-touch-evidence/) | [PRD-055](requires-touch-evidence/PRD-055-native-hud-reopened.md) | Android touch-playability evidence |
| [`requires-physical-device/`](requires-physical-device/) | [PRD-056](requires-physical-device/PRD-056-physical-mobile-qualification.md) | Named physical Android/iOS devices, signed artifacts, and Apple credentials |
| [`review-cap/`](review-cap/) | [PRD-057](review-cap/PRD-057-native-audio-parity.md) | Specification reopen after the review cap |
| [`requires-physical-proof/`](requires-physical-proof/) | [PRD-058](requires-physical-proof/PRD-058-performance-reliability-observability.md) | Current-candidate physical evidence and marker-control repair |
| [`requires-hosted-run/`](requires-hosted-run/) | [PRD-059](requires-hosted-run/PRD-059-native-dependency-provenance-sbom.md) | Same-candidate hosted prerelease evidence |
| [`requires-release-credentials/`](requires-release-credentials/) | [PRD-060](requires-release-credentials/PRD-060-promoted-consumer-distribution.md) | Release, registry, and platform-signing credentials plus prerequisite evidence |
| [`requires-ray-measurement/`](requires-ray-measurement/) | [PRD-088](requires-ray-measurement/PRD-088-physics-spatial-queries.md) | Authoritative pre-implementation ray measurement |
| [`requires-packed-gate/`](requires-packed-gate/) | [PRD-112](requires-packed-gate/PRD-112-golden-path-from-packed-artifacts.md), [repair](requires-packed-gate/PRD-112-repair-golden-path-contract.md) | Green packed seven-template gate |
| [`requires-sealed-proof/`](requires-sealed-proof/) | [PRD-113](requires-sealed-proof/PRD-113-sealed-brief-naming-contract.md), [repair](requires-sealed-proof/PRD-113-repair-sealed-behavior-proof.md) | Positive behavior-based sealed proof |
| [`requires-paired-round/`](requires-paired-round/) | [PRD-114](requires-paired-round/PRD-114-paired-round-on-the-repaired-instrument.md) | Fresh paired framework/vanilla round |

Moved on 2026-08-15. The old `docs/PRDs/native/blocked/README.md` remains as a native-lane
compatibility pointer; no PRD files remain there.
