import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from 'three';
import { YukaPerception } from '../dist/perception.js';
function fixture() {
  const body = new Object3D(), target = new Object3D(); target.position.z = 8;
  const wall = new Mesh(new BoxGeometry(5, 5, 0.5), new MeshBasicMaterial()); wall.position.z = 4;
  const raycaster = new Raycaster(); let blocked = false;
  const brain = new YukaPerception({body, fieldOfView: Math.PI / 2, range: 10, forward: [0,0,1], memorySeconds: 2, arrivalDistance: 0.2,
    raycast: ({origin, direction, distance}) => {
      if (!blocked) return null;
      wall.updateMatrixWorld(true); raycaster.set(new Vector3(...origin), new Vector3(...direction)); raycaster.near = 0; raycaster.far = distance;
      return raycaster.intersectObject(wall, false)[0]?.distance ?? null;
    }});
  return {body, target, brain, block: value => {blocked = value;}, dispose: () => {brain.dispose(); wall.geometry.dispose(); wall.material.dispose();}};
}
test('actual Yuka vision and Three raycasts respect occlusion and last-seen memory', () => {
  const f = fixture(); const target = {id: 'player', object: f.target};
  assert.equal(f.brain.update(0, target).state, 'chase'); f.block(true); f.target.position.z = 9;
  assert.deepEqual(f.brain.update(1, target).destination, [0,0,8]);
  assert.equal(f.brain.update(1, target).state, 'patrol'); f.dispose();
});
test('FOV and world rotation use the authored forward axis', () => {
  const f = fixture(); const target = {id: 'player', object: f.target}; f.body.rotation.y = Math.PI;
  assert.equal(f.brain.update(0, target).state, 'patrol'); f.target.position.z = -8;
  assert.equal(f.brain.update(0, target).state, 'chase'); f.target.position.z = -11;
  assert.equal(f.brain.update(0.1, target).state, 'search'); f.dispose();
});
test('perception never takes ownership of movement and disposal is enforced', () => {
  const f = fixture(); const original = f.body.position.clone();
  for (let i = 0; i < 30; i++) f.brain.update(1/60, {id: 'player', object: f.target});
  assert.deepEqual(f.body.position, original); f.dispose(); assert.throws(() => f.brain.update(0, null), /disposed/);
});
