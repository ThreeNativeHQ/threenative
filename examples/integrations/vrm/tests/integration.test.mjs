import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVrmModelReader } from '../dist/avatars.js';
// Synthetic metadata and skeleton authored for this test. No redistributed avatar assets.
function fixture() {
  const names=['hips','spine','chest','neck','head','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'];
  const nodes=names.map(name=>({name,translation:[0,0.1,0]}));
  const child=(a,...b)=>{nodes[names.indexOf(a)].children=b.map(n=>names.indexOf(n));};
  child('hips','spine','leftUpperLeg','rightUpperLeg');child('spine','chest');child('chest','neck','leftUpperArm','rightUpperArm');child('neck','head');
  for(const side of ['left','right']){child(`${side}UpperLeg`,`${side}LowerLeg`);child(`${side}LowerLeg`,`${side}Foot`);child(`${side}UpperArm`,`${side}LowerArm`);child(`${side}LowerArm`,`${side}Hand`);}
  return {asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes,extensionsUsed:['VRMC_vrm'],extensions:{VRMC_vrm:{specVersion:'1.0',meta:{name:'Synthetic test rig',authors:['ThreeNative'],licenseUrl:'https://vrm.dev/licenses/1.0/'},humanoid:{humanBones:Object.fromEntries(names.map((name,i)=>[name,{node:i}]))},expressions:{preset:{happy:{isBinary:false}}}}}};
}
const bytes = json => new TextEncoder().encode(JSON.stringify(json));
test('real VRM plugin creates independent humanoids and expression state',async()=>{
  const reader=createVrmModelReader(new GLTFLoader(),{readBytes:async()=>bytes(fixture())});
  const asset=await reader.model('assets/hash.glb'); assert.equal(asset.kind,'vrm1');
  const a=await asset.instantiate(),b=await asset.instantiate();
  try {assert.notEqual(a.scene,b.scene);assert.notEqual(a.vrm.humanoid,b.vrm.humanoid);a.setExpression('happy',1);a.update(1/60);assert.equal(b.vrm.expressionManager.getValue('happy'),0);assert.throws(()=>a.setExpression('missing',1));assert.throws(()=>a.update(-1));}
  finally{a.dispose();b.dispose();asset.dispose();reader.dispose();}
});
test('ordinary GLTF uses the same configured loader without manufacturing VRM state',async()=>{
  const reader=createVrmModelReader(new GLTFLoader(),{readBytes:async()=>bytes({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]})});
  const result=await reader.model('plain.gltf');assert.ok(result.scene);assert.equal(result.userData.vrm,undefined);reader.dispose();
});
test('aborted instantiation, reader teardown and duplicate registration fail explicitly',async()=>{
  const loader=new GLTFLoader(),reader=createVrmModelReader(loader,{readBytes:async()=>bytes(fixture())});
  assert.throws(()=>createVrmModelReader(loader),/already/);const asset=await reader.model('rig.glb');const abort=new AbortController();abort.abort();
  await assert.rejects(asset.instantiate(abort.signal),{name:'AbortError'});reader.dispose();reader.dispose();await assert.rejects(asset.instantiate(),/disposed/);
});
