// Generated for you: this is ordinary Three.js + TSL. Edit the look and motion freely.
import { GPUParticles3D } from "@threenative/core";
import { AdditiveBlending } from "three";
import {
  Fn,
  If,
  deltaTime,
  float,
  hash,
  instanceIndex,
  mix,
  time,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { SpriteNodeMaterial } from "three/webgpu";

const AMOUNT = 120;

export function createParticles(): GPUParticles3D {
  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  material.scaleNode = vec2(0.11);
  const falloff = float(1).sub(uv().sub(0.5).length().mul(2)).max(0).pow(2);
  material.colorNode = vec4(
    mix(vec3(0.2, 0.65, 1), vec3(1, 0.82, 0.38), time.sin().mul(0.5).add(0.5)),
    falloff,
  );

  return new GPUParticles3D({
    amount: AMOUNT,
    material,
    start: ({ positions, velocities }) =>
      Fn(() => {
        positions
          .element(instanceIndex)
          .assign(
            vec3(
              hash(instanceIndex).sub(0.5).mul(8),
              hash(instanceIndex.add(13)).sub(0.5).mul(3.2),
              hash(instanceIndex.add(29)).sub(0.5).mul(2),
            ),
          );
        velocities.element(instanceIndex).assign(vec3(0, hash(instanceIndex.add(41)).mul(0.35), 0));
      })().compute(AMOUNT),
    process: ({ positions, velocities }) =>
      Fn(() => {
        const position = positions.element(instanceIndex);
        const velocity = velocities.element(instanceIndex);
        velocity.y.assign(velocity.y.add(time.cos().mul(0.004)));
        position.addAssign(velocity.mul(deltaTime.min(1 / 30)));
        If(position.y.greaterThan(1.8), () => {
          position.assign(vec3(position.x, -1.8, position.z));
        });
      })().compute(AMOUNT),
  });
}
