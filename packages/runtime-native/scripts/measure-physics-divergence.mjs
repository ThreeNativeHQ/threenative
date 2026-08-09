#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(runtimeRoot, '..', '..');
const physicsRoot = join(workspaceRoot, 'packages', 'physics');
const nativeManifest = join(runtimeRoot, 'native', 'physics', 'Cargo.toml');
const requirePhysics = createRequire(join(physicsRoot, 'package.json'));
const RAPIER = requirePhysics('@dimforge/rapier3d-compat');

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const x = 0.01;
const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, -0.6, 0));
world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4), floor);
const boxes = [];
for (let index = 0; index < 5; index += 1) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, index, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
  boxes.push(body);
}
for (let tick = 0; tick < 300; tick += 1) world.step();
const webSnapshot = world.takeSnapshot();
const webPositions = boxes.map((body) => {
  const position = body.translation();
  return [position.x, position.y, position.z];
});

const native = JSON.parse(execFileSync(
  'cargo',
  ['run', '--quiet', '--manifest-path', nativeManifest, '--example', 'measure_stack'],
  { cwd: workspaceRoot, encoding: 'utf8' },
));
const nativeSnapshot = Buffer.from(native.snapshotHex, 'hex');
const nativePositions = native.positionBits.map((position) => position.map((bits) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits);
  return view.getFloat32(0);
}));
if (webSnapshot.length === 0 || nativeSnapshot.length === 0) {
  throw new Error('Physics divergence measurement produced an empty snapshot');
}
if (webPositions.length !== 5 || nativePositions.length !== 5) {
  throw new Error('Physics divergence measurement must report all five boxes');
}
let mismatchedBytes = 0;
for (let index = 0; index < Math.max(webSnapshot.length, nativeSnapshot.length); index += 1) {
  if (webSnapshot[index] !== nativeSnapshot[index]) mismatchedBytes += 1;
}
const positionDeltas = webPositions.map((web, bodyIndex) =>
  web.map((value, axis) => Math.abs(value - nativePositions[bodyIndex][axis])),
);
const maxPosition = Math.max(...positionDeltas.flat());
if (mismatchedBytes === 0 || !Number.isFinite(maxPosition)) {
  throw new Error('Physics divergence measurement did not observe a valid version delta');
}

console.log(JSON.stringify({
  scene: 'five boxes on a floor, seed 1, 300 ticks at 1/60',
  web: {
    version: RAPIER.version(),
    snapshotBytes: webSnapshot.length,
    positions: webPositions,
  },
  native: {
    version: native.version,
    snapshotBytes: nativeSnapshot.length,
    positions: nativePositions,
  },
  delta: {
    snapshotBytes: nativeSnapshot.length - webSnapshot.length,
    mismatchedBytes,
    positions: positionDeltas,
    maxPosition,
  },
}, null, 2));
world.free();
