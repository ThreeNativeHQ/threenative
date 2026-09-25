import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { computeMeshVolume } from 'three-bvh-csg';
import { evaluateSolid } from '../dist/csg.js';
import { writeSolidGlb } from '../dist/export-glb.js';
function operands() {
  const material=new MeshStandardMaterial();
  const wall=new Mesh(new BoxGeometry(4,3,0.3),material); wall.position.y=1.5;
  const cutter=new Mesh(new BoxGeometry(1,2.2,1),material); cutter.position.y=0.9;
  return {wall,cutter,material,dispose(){wall.geometry.dispose();cutter.geometry.dispose();material.dispose();}};
}
const hit=(mesh,x,y)=>{ mesh.updateMatrixWorld(true); return new Raycaster(new Vector3(x,y,2),new Vector3(0,0,-1)).intersectObject(mesh).length>0; };
test('real donor makes a doorway with correct solid volume and leaves shared inputs alive',()=>{
  const fixture=operands(); let materialDisposed=0; fixture.material.addEventListener('dispose',()=>materialDisposed++);
  const result=evaluateSolid(fixture.wall,fixture.cutter,'subtract');
  try { assert.ok(Math.abs(computeMeshVolume(result.mesh)-3)<1e-4); assert.equal(hit(result.mesh,0,1),false); assert.equal(hit(result.mesh,1.5,1),true); }
  finally { result.dispose(); result.dispose(); assert.equal(materialDisposed,0); fixture.dispose(); }
});
test('real GLB write/read preserves the opening and material groups',async()=>{
  const fixture=operands(); const result=evaluateSolid(fixture.wall,fixture.cutter,'subtract');
  try {
    const doc=await new NodeIO().readBinary(await writeSolidGlb(result.mesh));
    const primitives=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives()); assert.ok(primitives.length>0);
    const restored=primitives.map(p=>{
      const g=new BufferGeometry(); g.setAttribute('position',new BufferAttribute(p.getAttribute('POSITION').getArray(),3));
      g.setIndex(new BufferAttribute(p.getIndices().getArray(),1)); return new Mesh(g,fixture.material);
    });
    assert.equal(restored.some(m=>hit(m,0,1)),false); assert.equal(restored.some(m=>hit(m,1.5,1)),true);
    restored.forEach(m=>m.geometry.dispose());
  } finally {result.dispose();fixture.dispose();}
});
test('invalid transform fails before changing either input',()=>{
  const f=operands();f.cutter.scale.x=0;
  try {assert.throws(()=>evaluateSolid(f.wall,f.cutter,'subtract'),/singular/);assert.equal(f.wall.position.y,1.5);}finally{f.dispose();}
});
test('untextured union and empty intersection have explicit outcomes',()=>{
  const f=operands();f.cutter.position.x=10;
  const union=evaluateSolid(f.wall,f.cutter,'union');const empty=evaluateSolid(f.wall,f.cutter,'intersect');
  try {assert.ok(union.mesh.geometry.index.count>0);assert.equal(empty.mesh.geometry.index.count,0);}finally{union.dispose();empty.dispose();f.dispose();}
});
