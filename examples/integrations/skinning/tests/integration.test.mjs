import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial, Raycaster, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { AnimatedInstances } from '../dist/animated-instances.js';
function rig() {
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array([-0.5,0,0,0.5,0,0,0,1,0]),3));
 geometry.setAttribute('normal',new BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1]),3));
 geometry.setAttribute('skinIndex',new BufferAttribute(new Uint16Array(12),4));
 geometry.setAttribute('skinWeight',new BufferAttribute(new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),4));
 const mesh=new SkinnedMesh(geometry,new MeshBasicMaterial());const bone=new Bone();bone.name='root';mesh.add(bone);mesh.bind(new Skeleton([bone]));
 return {mesh,bone,dispose(){geometry.dispose();mesh.material.dispose();mesh.skeleton.dispose();}};
}
function batch(source){return new AnimatedInstances({source,material:new MeshStandardNodeMaterial(),capacity:4,byteBudget:100000,maxStorageBufferBindingSize:1024*1024});}
test('real Three skinning pose agrees with the CPU pick geometry and stable instance ids',()=>{
 const f=rig(),b=batch(f.mesh);const first=b.add(f.mesh,new Matrix4().makeTranslation(-2,0,0));
 f.bone.position.y=2;const second=b.add(f.mesh,new Matrix4().makeTranslation(2,0,0));b.prepare(0);
 const ray=new Raycaster(new Vector3(2,2.2,3),new Vector3(0,0,-1));const hits=ray.intersectObject(b.mesh);
 assert.equal(hits.length,1);assert.equal(hits[0].instanceId,second.slot);assert.equal(hits[0].instanceGeneration,second.generation);
 b.remove(first);b.prepare(1);assert.equal(ray.intersectObject(b.mesh)[0].instanceId,second.slot);b.dispose();f.dispose();
});
test('node graph and storage are created without adopting WebGL or a second renderer',()=>{
 const f=rig(),b=batch(f.mesh);b.add(f.mesh,new Matrix4());b.prepare(0);
 assert.equal(b.mesh.geometry.isInstancedBufferGeometry,true);assert.equal(b.mesh.isInstancedMesh,undefined);
 assert.ok(b.mesh.material.positionNode);assert.equal(b.mesh.geometry.instanceCount,1);b.dispose();f.dispose();
});
test('batch cleanup leaves borrowed source geometry and material alive',()=>{
 const f=rig(),material=new MeshStandardNodeMaterial();let disposed=0;f.mesh.geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);
 const b=new AnimatedInstances({source:f.mesh,material,capacity:1,byteBudget:100000,maxStorageBufferBindingSize:1024*1024});
 b.dispose();b.dispose();assert.equal(disposed,0);assert.throws(()=>b.add(f.mesh,new Matrix4()),/disposed/);f.dispose();material.dispose();
});
