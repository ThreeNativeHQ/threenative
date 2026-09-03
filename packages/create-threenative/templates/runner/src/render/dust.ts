// Generated for you: ordinary Three.js TSL. `GPUParticles3D` owns the pooling, the dispatch and
// the lifetime; every appearance choice below — the count, the spawn shape, the launch, the
// colour ramp, the sprite mask — is this file's, and this file is yours.
import {
  Fn,
  float,
  fract,
  hash,
  instanceIndex,
  mix,
  smoothstep,
  time,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  type ComputeNode,
  SpriteNodeMaterial,
  type StorageBufferNode,
} from "three/webgpu";
import { palette } from "./palette.js";

export interface IDustBuffers {
  readonly positions: StorageBufferNode<"vec3">;
  readonly velocities: StorageBufferNode<"vec3">;
}

export interface IDustOptions {
  readonly amount: number;
  readonly material: SpriteNodeMaterial;
  readonly start: (buffers: IDustBuffers) => ComputeNode;
  readonly process: (buffers: IDustBuffers) => ComputeNode;
}

const AMOUNT = 220;
const LIFETIME = 0.9;
/** Metres per second the trail drifts backwards. It is the track that moves, so this is small. */
const DRIFT = 2.6;
const SPREAD = 0.55;

function noise(salt: number) {
  return hash(instanceIndex.add(salt));
}

/** Each particle owns a phase offset, so the emitter is continuous rather than a pulsing burst. */
function phase() {
  return fract(time.div(LIFETIME).add(noise(19)));
}

function spawn() {
  return vec3(
    noise(3).sub(0.5).mul(SPREAD),
    noise(7).mul(0.14),
    noise(11)
      .sub(0.5)
      .mul(SPREAD * 0.5),
  );
}

function launch() {
  return vec3(
    noise(23).sub(0.5).mul(1.1),
    noise(29).mul(1.4).add(0.2),
    noise(31)
      .mul(DRIFT)
      .add(DRIFT * 0.4),
  );
}

/** A soft round puff: no texture, no download, and it fades at both ends of its life. */
function puff() {
  return float(1).sub(smoothstep(0.06, 0.5, uv().sub(0.5).length()));
}

/**
 * The dust the runner throws up.
 *
 * Two colours: the track's own grey at birth and the warm horizon at death, so the trail reads as
 * lit by the same sky the track is. Change the numbers above and the whole feel changes; change
 * `puff` and the grain does.
 */
export function createDustTrail(): IDustOptions {
  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  const life = varying(phase());
  material.scaleNode = vec2(0.42).mul(mix(0.5, 1.5, life));
  const birth = new Array(3)
    .fill(0)
    .map((_, index) => ((palette.rail >> (16 - index * 8)) & 255) / 255);
  const death = new Array(3)
    .fill(0)
    .map((_, index) => ((palette.skyLow >> (16 - index * 8)) & 255) / 255);
  material.colorNode = vec4(
    mix(
      vec3(birth[0] ?? 0, birth[1] ?? 0, birth[2] ?? 0),
      vec3(death[0] ?? 0, death[1] ?? 0, death[2] ?? 0),
      life,
    ),
    puff()
      .mul(float(1).sub(smoothstep(0.55, 1, life)))
      .mul(0.55),
  );

  const start = ({ positions, velocities }: IDustBuffers): ComputeNode =>
    Fn(() => {
      positions.element(instanceIndex).assign(spawn());
      velocities.element(instanceIndex).assign(launch());
    })().compute(AMOUNT);

  const process = ({ positions, velocities }: IDustBuffers): ComputeNode =>
    Fn(() => {
      const velocity = launch();
      const elapsed = phase().mul(LIFETIME);
      positions.element(instanceIndex).assign(
        spawn()
          .add(velocity.mul(elapsed))
          .add(vec3(0, -1.6, 0).mul(elapsed.mul(elapsed))),
      );
      velocities.element(instanceIndex).assign(velocity);
    })().compute(AMOUNT);

  return { amount: AMOUNT, material, process, start };
}
