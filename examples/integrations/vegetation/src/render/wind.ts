import { MeshStandardNodeMaterial } from 'three/webgpu';
import { Fn, float, normalGeometry, normalLocal, positionGeometry, uniform, vec3 } from 'three/tsl';
import type { BufferGeometry, Object3D } from 'three';
import { validateWind, type IWind } from '../geometry.js';

/** Editable appearance, intentionally not an engine preset. This lane is for ordinary meshes. */
export function createTreeWind(base: MeshStandardNodeMaterial, options: IWind) {
  const wind=validateWind(options);
  if (base.positionNode || base.normalNode || base.displacementMap)
    throw new Error('Tree wind needs an unmodified vertex path; compose custom appearance in this source file.');
  const material=base.clone(); const simulationTime=uniform(0); let disposed=false;
  const direction=vec3(wind.direction[0],0,wind.direction[1]);
  material.positionNode=Fn((_: unknown, builder: { readonly object: Object3D | null; readonly geometry: BufferGeometry | null })=>{
    const object=builder.object;
    if (!object || 'isInstancedMesh' in object || 'isSkinnedMesh' in object || (builder.geometry && 'isInstancedBufferGeometry' in builder.geometry))
      throw new Error('Tree wind currently supports ordinary meshes only; use static generated variants for instanced forests.');
    const t=positionGeometry.y.sub(wind.base).div(wind.extent).clamp(0,1);
    const oscillation=simulationTime.mul(wind.frequency).add(wind.phase).sin().mul(wind.amplitude);
    const offset=oscillation.mul(t.mul(t).mul(float(3).sub(t.mul(2))));
    const derivative=oscillation.mul(t).mul(float(1).sub(t)).mul(6/wind.extent);
    normalLocal.assign(normalGeometry.sub(vec3(0,derivative.mul(direction.dot(normalGeometry)),0)).normalize());
    return positionGeometry.add(direction.mul(offset));
  })();
  return {
    material,
    updateTime(seconds:number):void {
      if(disposed) throw new Error('Tree wind is disposed.');
      if(!Number.isFinite(seconds)) throw new Error('Tree wind time must be finite simulation time.');
      simulationTime.value=seconds;
    },
    expandBounds(geometry:BufferGeometry):void {
      if(disposed) throw new Error('Tree wind is disposed.');
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      if(geometry.boundingBox){
        const x=Math.abs(wind.direction[0])*wind.amplitude;const z=Math.abs(wind.direction[1])*wind.amplitude;
        geometry.boundingBox.min.x-=x;geometry.boundingBox.max.x+=x;geometry.boundingBox.min.z-=z;geometry.boundingBox.max.z+=z;
      }
      if(geometry.boundingSphere) geometry.boundingSphere.radius+=wind.amplitude;
    },
    dispose():void { if(!disposed) { disposed=true; material.dispose(); } },
  };
}
