export interface IInstanceHandle { readonly slot: number; readonly generation: number; }
export interface IFrameSnapshot { readonly frame: number; readonly count: number; }
function positiveInteger(value:number,label:string):void {
  if(!Number.isSafeInteger(value)||value<1) throw new Error(`Skinning ${label} must be a positive safe integer.`);
}
function matrices(values:ArrayLike<number>,count:number,label:string):void {
  if(values.length!==count*16) throw new Error(`Skinning ${label} must contain ${count} matrices.`);
  for(let i=0;i<values.length;i++) if(!Number.isFinite(values[i]) || !Number.isFinite(Math.fround(values[i]))) throw new Error(`Skinning ${label} has non-finite data.`);
  for(let i=0;i<values.length;i+=16)
    if(Math.abs(values[i+3])+Math.abs(values[i+7])+Math.abs(values[i+11])+Math.abs(values[i+15]-1)>1e-5)
      throw new Error(`Skinning ${label} must contain affine matrices.`);
}
function copy(source:ArrayLike<number>,from:number,target:Float32Array,to:number,count:number):void {
  for(let i=0;i<count;i++) target[to+i]=source[from+i];
}
/** Logical slots and last-presented history are independent of compact draw indices. */
export class FramePalette {
  readonly capacity:number; readonly bones:number; readonly byteLength:number;
  readonly currentBones:Float32Array; readonly previousBones:Float32Array;
  readonly currentTransforms:Float32Array; readonly previousTransforms:Float32Array;
  readonly drawSlots:Uint32Array; readonly drawGenerations:Uint32Array;
  readonly #stagedBones:Float32Array; readonly #lastBones:Float32Array;
  readonly #stagedTransforms:Float32Array; readonly #lastTransforms:Float32Array;
  readonly #alive:Uint8Array; readonly #generations:Uint32Array; readonly #lastGenerations:Uint32Array;
  readonly #free:number[]=[];
  #snapshot:IFrameSnapshot={frame:-1,count:0}; #disposed=false;
  constructor(capacity:number,bones:number,byteBudget:number) {
    positiveInteger(capacity,'capacity');positiveInteger(bones,'bone count');positiveInteger(byteBudget,'byte budget');
    // Includes all typed arrays and conservatively eight bytes per free-list entry.
    const bytes=capacity*(256*(bones+1)+25);
    if(!Number.isSafeInteger(bytes)||bytes>byteBudget) throw new Error('Skinning palette exceeds the CPU byte budget.');
    this.capacity=capacity;this.bones=bones;this.byteLength=bytes;
    const pose=capacity*bones*16;const transform=capacity*16;
    this.currentBones=new Float32Array(pose);this.previousBones=new Float32Array(pose);
    this.#stagedBones=new Float32Array(pose);this.#lastBones=new Float32Array(pose);
    this.currentTransforms=new Float32Array(transform);this.previousTransforms=new Float32Array(transform);
    this.#stagedTransforms=new Float32Array(transform);this.#lastTransforms=new Float32Array(transform);
    this.#alive=new Uint8Array(capacity);this.#generations=new Uint32Array(capacity);this.#lastGenerations=new Uint32Array(capacity);
    this.drawSlots=new Uint32Array(capacity);this.drawGenerations=new Uint32Array(capacity);
    for(let i=capacity-1;i>=0;i--) this.#free.push(i);
  }
  #live():void { if(this.#disposed) throw new Error('Skinning palette is disposed.'); }
  #slot(handle:IInstanceHandle):number {
    this.#live();const {slot,generation}=handle;
    if(!Number.isInteger(slot)||slot<0||slot>=this.capacity||!this.#alive[slot]||this.#generations[slot]!==generation)
      throw new Error('Skinning instance handle is stale or invalid.');
    return slot;
  }
  allocate(pose:ArrayLike<number>,transform:ArrayLike<number>):IInstanceHandle {
    this.#live();matrices(pose,this.bones,'pose');matrices(transform,1,'transform');
    const slot=this.#free.pop();if(slot===undefined) throw new Error('Skinning capacity is exhausted.');
    if(this.#generations[slot]===0xffffffff){this.#free.push(slot);throw new Error('Skinning slot generation exhausted; create a new batch.');}
    const generation=++this.#generations[slot];this.#alive[slot]=1;
    copy(pose,0,this.#stagedBones,slot*this.bones*16,pose.length);copy(transform,0,this.#stagedTransforms,slot*16,16);
    return Object.freeze({slot,generation});
  }
  release(handle:IInstanceHandle):void {const slot=this.#slot(handle);this.#alive[slot]=0;this.#free.push(slot);}
  writePose(handle:IInstanceHandle,pose:ArrayLike<number>):void {
    const slot=this.#slot(handle);matrices(pose,this.bones,'pose');copy(pose,0,this.#stagedBones,slot*this.bones*16,pose.length);
  }
  writeTransform(handle:IInstanceHandle,transform:ArrayLike<number>):void {
    const slot=this.#slot(handle);matrices(transform,1,'transform');copy(transform,0,this.#stagedTransforms,slot*16,16);
  }
  /** Call once before all passes for a rendered frame. Same-frame calls never advance history. */
  prepare(frame:number):IFrameSnapshot {
    this.#live();
    if(!Number.isSafeInteger(frame)||frame<0||frame<this.#snapshot.frame) throw new Error('Skinning frame ids must be monotonic nonnegative integers.');
    if(frame===this.#snapshot.frame)return this.#snapshot;
    let draw=0;const stride=this.bones*16;
    for(let slot=0;slot<this.capacity;slot++) {
      if(!this.#alive[slot])continue;
      const established=this.#lastGenerations[slot]===this.#generations[slot];
      copy(this.#stagedBones,slot*stride,this.currentBones,draw*stride,stride);
      copy(established?this.#lastBones:this.#stagedBones,slot*stride,this.previousBones,draw*stride,stride);
      copy(this.#stagedTransforms,slot*16,this.currentTransforms,draw*16,16);
      copy(established?this.#lastTransforms:this.#stagedTransforms,slot*16,this.previousTransforms,draw*16,16);
      copy(this.#stagedBones,slot*stride,this.#lastBones,slot*stride,stride);
      copy(this.#stagedTransforms,slot*16,this.#lastTransforms,slot*16,16);
      this.#lastGenerations[slot]=this.#generations[slot];
      this.drawSlots[draw]=slot;this.drawGenerations[draw]=this.#generations[slot];draw++;
    }
    this.#snapshot=Object.freeze({frame,count:draw});return this.#snapshot;
  }
  dispose():void {this.#disposed=true;this.#alive.fill(0);this.#free.length=0;}
}
/** CPU reference and on-demand picking path for geometry-local normalized bone matrices. */
export function skinPoint(bones:ArrayLike<number>,indices:ArrayLike<number>,weights:ArrayLike<number>,point:ArrayLike<number>,out:number[]=[0,0,0]):number[] {
  if(indices.length!==4||weights.length!==4||point.length!==3||bones.length%16!==0)
    throw new Error('Skinning requires four influences and a vec3 point.');
  let total=0;
  for(let i=0;i<4;i++) {
    if(!Number.isInteger(indices[i])||indices[i]<0||indices[i]>=bones.length/16) throw new Error('Skinning bone index is outside its palette.');
    if(!Number.isFinite(weights[i])||weights[i]<0) throw new Error('Skinning weights must be finite and nonnegative.');
    total+=weights[i];
  }
  if(Math.abs(total-1)>1e-4||Array.from(point).some(v=>!Number.isFinite(v))) throw new Error('Skinning weights must sum to one and positions must be finite.');
  out[0]=out[1]=out[2]=0;
  for(let influence=0;influence<4;influence++) {
    const offset=indices[influence]*16;const weight=weights[influence];
    for(let axis=0;axis<3;axis++) out[axis]+=weight*(bones[offset+axis]*point[0]+bones[offset+4+axis]*point[1]+bones[offset+8+axis]*point[2]+bones[offset+12+axis]);
  }
  if(out.some(value=>!Number.isFinite(value))) throw new Error('Skinning result is not finite.');
  return out;
}
