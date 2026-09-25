import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bone, Group, Vector3, Skeleton, SkinnedMesh, BufferGeometry, MeshBasicMaterial } from 'three';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';
import { ConstrainedIK } from '../dist/constrained-ik.js';
function fixture(scale=1) {
  const parent=new Group();parent.position.set(3,4,0);parent.scale.setScalar(scale);
  const root=new Bone();root.name='shoulder';const tip=new Bone();tip.name='hand';tip.position.x=2;root.add(tip);parent.add(root);
  const ik=new ConstrainedIK({root,joints:[{bone:root,axes:['z'],min:[-Math.PI],max:[Math.PI]}],effectors:[{bone:tip}],iterations:128,positionTolerance:0.005,rotationTolerance:0.001});
  return {parent,root,tip,ik};
}
test('actual closed-chain solver reaches a target through a translated/scaled parent',()=>{
  for(const scale of [1,2]) {
    const f=fixture(scale); const target=[3,4+2*scale,0]; const report=f.ik.update([{position:target}]);
    assert.ok(report.residuals[0].metres<0.005);assert.deepEqual(f.root.position.toArray(),[0,0,0]);
    assert.ok(Math.abs(f.tip.getWorldPosition(new Vector3()).distanceTo(f.root.getWorldPosition(new Vector3()))-2*scale)<1e-6);f.ik.dispose();
  }
});
test('unreachable target stays finite and is not reported as converged',()=>{
  const f=fixture();const report=f.ik.update([{position:[100,100,0]}]);assert.equal(report.converged,false);
  assert.ok(f.root.quaternion.toArray().every(Number.isFinite));f.ik.dispose();
});
test('bad targets do not corrupt the rendered pose; disposed adapters refuse work',()=>{
  const f=fixture();const q=f.root.quaternion.toArray();assert.throws(()=>f.ik.update([{position:[NaN,0,0]}]));assert.deepEqual(f.root.quaternion.toArray(),q);
  f.ik.dispose();f.ik.dispose();assert.throws(()=>f.ik.update([{position:[0,0,0]}]),/disposed/);
});
test('zero blend measures residual without applying correction',()=>{
  const f=fixture();const q=f.root.quaternion.toArray();const report=f.ik.update([{position:[3,6,0]}],0);
  assert.deepEqual(f.root.quaternion.toArray(),q);assert.ok(report.residuals[0].metres>1);f.ik.dispose();
});
test('ordinary one-limb target is also solvable by the upstream CCD baseline',()=>{
  const root=new Bone();const tip=new Bone();tip.position.x=2;root.add(tip);const target=new Bone();target.position.set(0,2,0);
  const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());mesh.add(root,target);mesh.bind(new Skeleton([root,tip,target]));mesh.updateMatrixWorld(true);
  const ccd=new CCDIKSolver(mesh,[{target:2,effector:1,links:[{index:0}],iteration:16}]);ccd.update();
  assert.ok(tip.getWorldPosition(new Vector3()).distanceTo(target.getWorldPosition(new Vector3()))<0.005);
  mesh.geometry.dispose();mesh.material.dispose();mesh.skeleton.dispose();
});
