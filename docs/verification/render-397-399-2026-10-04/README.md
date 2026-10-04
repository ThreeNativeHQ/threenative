# Combined exposure and fog qualification

Actual browser captures from source `b0560e3c623ffb5eba607ce30f14c646dd84de0b`, using the existing fog fixture and public standalone playtest harness on Linux, NVIDIA Turing WebGPU, 640×400 pixels. Fog uses 48 steps, full-resolution transport, density 0.18, the fixture's authored directional/point lights, neutral tone mapping, and constant exposure 1 for the off control. Automatic exposure uses the unchanged authored exposure policy with `enabled: true` in its enabled arms. Bloom and screen-space AA are disabled.

[Off control](off.png) | [Fog and automatic exposure](fog-and-exposure.png)

[Actual passing report](joint-pass.json): all seven arms passed—off, fog only, exposure only, both, repeated both, rebuild/resize/restore, and disposal. Each arm recorded its actual normal shared capture lease holder. Enabled transitions require a fresh positive finite 1×1 GPU readback from the current render generation, settled exposure, and the unchanged three completed-render/texture-stability boundary. Disposal returns actual renderer texture memory to the off baseline.

The repeated baseline's average RGB difference was 0.12984 levels (maximum 1). Fog's marginal response was 12.86908 (maximum 247); exposure's was 23.95996 (maximum 62). These responses exceed measured repeat noise and the existing two-level quantization bound. These are functional correctness results, with no frame-time, Android, macOS, Windows, or combined native-runtime qualification claim.

The [initial failed lifecycle attempt](initial-lifecycle-failure.json), source `fea52b9c7d16e4be229273f8bf113cd70152d018`, is retained. Its first five controls passed, but resize correctly failed the existing three-render stability guard after only one observed boundary. The corrected harness adds the missing boundary waits and fresh-readback observation; assertions and thresholds remain unchanged.

Original exposure and fog PRDs and immutable historical proof remain intact. Sailing first-height readback and fluid consumer failures remain unresolved; these captures do not establish green exact-head CI or a merge to develop.
