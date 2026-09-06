// Generated for you: flora wind as a CPU update over the foliage instances.
// Phase 0 measured the TSL custom-attribute path as not wireable here without
// storage buffers, so this file takes the one path the PRD allows as the
// alternative: a CPU update that stays inside budget by reusing one scratch
// object and writing only instance matrices — zero allocation after warm-up.
//
// Semantics (mined, not ported): rotational bending — tips move most, ground
// anchors stay rigid; strength 0 displaces zero vertices. No GLSL anywhere.
import type { InstancedMesh } from "three";
import { Object3D } from "three";
import type { IFloraStandSample } from "./floraSample.js";

export interface IFloraWindController {
  setStrength(strength: number): void;
  /** Advance the sway clock; call once per frame from the scene. */
  update(elapsedSeconds: number): void;
  /** CPU probe of the tip sway at a clock value. 0 strength yields 0. */
  sampleTipDisplacement(timeSeconds: number): number;
  readonly strength: number;
}

/** Drive foliage sway on the CPU. No allocation per frame after warm-up. */
export function attachFloraWind(
  foliage: InstancedMesh,
  sample: IFloraStandSample,
  initialStrength: number,
): IFloraWindController {
  if (!Number.isFinite(initialStrength) || initialStrength < 0)
    throw new Error("TN_FLORA_WIND_INVALID: strength must be finite and >= 0.");
  let strength = initialStrength;
  let top = 0;
  for (const leaf of sample.leaves) top = Math.max(top, leaf.anchor[1]);
  const scale = top > 0 ? 1 / top : 0;
  // One scratch object for the life of the stand — update() never allocates.
  const scratch = new Object3D();
  const swayAt = (phase: number, heightMix: number, timeSeconds: number): number => {
    if (strength === 0) return 0;
    const t = timeSeconds * 1.4;
    const x = Math.sin(t + phase) * strength * 0.35 * heightMix;
    const z = Math.sin(t * 0.83 + phase * 1.7) * strength * 0.35 * 0.6 * heightMix;
    return Math.hypot(x, z);
  };
  let tipPhase = sample.leaves[0]?.phase ?? 0;
  let tipY = sample.leaves[0]?.anchor[1] ?? 0;
  for (const leaf of sample.leaves)
    if (leaf.anchor[1] > tipY) {
      tipY = leaf.anchor[1];
      tipPhase = leaf.phase;
    }
  return {
    get strength() {
      return strength;
    },
    sampleTipDisplacement: (timeSeconds: number) => swayAt(tipPhase, 1, timeSeconds),
    setStrength: (value: number) => {
      if (!Number.isFinite(value) || value < 0)
        throw new Error("TN_FLORA_WIND_INVALID: strength must be finite and >= 0.");
      strength = value;
    },
    update: (elapsedSeconds: number) => {
      if (strength === 0) return;
      const t = elapsedSeconds * 1.4;
      for (let index = 0; index < sample.leaves.length; index += 1) {
        const leaf = sample.leaves[index];
        if (leaf === undefined) continue;
        const heightMix = leaf.anchor[1] * scale;
        const bend = heightMix * strength * 0.35;
        const swayX = Math.sin(t + leaf.phase) * bend;
        const swayZ = Math.sin(t * 0.83 + leaf.phase * 1.7) * bend * 0.6;
        scratch.position.set(leaf.anchor[0] + swayX, leaf.anchor[1], leaf.anchor[2] + swayZ);
        scratch.rotation.set(0, leaf.angle, 0);
        scratch.scale.setScalar(leaf.size);
        scratch.updateMatrix();
        foliage.setMatrixAt(index, scratch.matrix);
      }
      foliage.instanceMatrix.needsUpdate = true;
    },
  };
}
