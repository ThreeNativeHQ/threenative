import { BufferAttribute, InstancedBufferGeometry, Matrix4, Mesh, Vector3, type Intersection, type Object3D, type Raycaster, type SkinnedMesh } from 'three';
import { MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { Fn, attribute, instanceIndex, normalGeometry, normalLocal, positionGeometry, positionPrevious, storage, vec4 } from 'three/tsl';
import { FramePalette, skinPoint, type IInstanceHandle, type IFrameSnapshot } from './palette.js';
export interface IAnimatedInstanceOptions {
  readonly source: SkinnedMesh;
  readonly material: MeshStandardNodeMaterial;
  readonly capacity: number;
  readonly byteBudget: number;
  /** Read from the actual GPU device limits, never guessed from an adapter name. */
  readonly maxStorageBufferBindingSize: number;
}
function rigidScale(matrix: Matrix4): void {
  const e = matrix.elements;
  const x = new Vector3(e[0], e[1], e[2]), y = new Vector3(e[4], e[5], e[6]), z = new Vector3(e[8], e[9], e[10]);
  const length = x.length(), tolerance = Math.max(length * length, 1e-8) * 1e-5;
  if (e.some(value => !Number.isFinite(value)) || length <= 1e-8 || matrix.determinant() <= 0 ||
      Math.abs(y.length() - length) > length * 1e-5 || Math.abs(z.length() - length) > length * 1e-5 ||
      Math.abs(x.dot(y)) > tolerance || Math.abs(x.dot(z)) > tolerance || Math.abs(y.dot(z)) > tolerance)
    throw new Error('Animated instances require positive uniform scale without shear.');
}
/** Experimental WebGPU mechanism. No automatic camera culling: all passes see the same snapshot. */
export class AnimatedInstances {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>;
  readonly palette: FramePalette;
  readonly #source: SkinnedMesh;
  readonly #pose: Float32Array;
  readonly #matrix = new Matrix4();
  readonly #buffers: readonly StorageBufferAttribute[];
  readonly #pick: Mesh;
  readonly #indices: BufferAttribute;
  readonly #weights: BufferAttribute;
  readonly #positions: BufferAttribute;
  readonly #point = new Vector3();
  #frame: IFrameSnapshot = {frame: -1, count: 0};
  #disposed = false;
  constructor(options: IAnimatedInstanceOptions) {
    const source = options.source, geometry = source.geometry;
    if (!source.isSkinnedMesh || !source.skeleton.bones.length) throw new Error('Animated instances require a bound skinned mesh.');
    if (Object.keys(geometry.morphAttributes).length || geometry.hasAttribute('tangent')) throw new Error('Morph targets and tangents are not supported in this admission fixture.');
    if (options.material.positionNode || options.material.normalNode || options.material.displacementMap)
      throw new Error('Supply a game material without an existing deformation path.');
    for (const [name, itemSize] of [['position', 3], ['normal', 3], ['skinIndex', 4], ['skinWeight', 4]] as const) {
      const a = geometry.getAttribute(name);
      if (!a || a.itemSize !== itemSize || 'isInterleavedBufferAttribute' in a || a.count !== geometry.getAttribute('position')?.count)
        throw new Error(`Animated instances need a non-interleaved '${name}' attribute with matching count.`);
    }
    const bindingBytes = options.capacity * source.skeleton.bones.length * 64;
    if (!Number.isSafeInteger(options.maxStorageBufferBindingSize) || options.maxStorageBufferBindingSize <= 0 || bindingBytes > options.maxStorageBufferBindingSize)
      throw new Error('Animated instance palette exceeds the device storage binding limit.');
    this.#source = source; this.#pose = new Float32Array(source.skeleton.bones.length * 16);
    this.#indices = geometry.getAttribute('skinIndex') as BufferAttribute;
    this.#weights = geometry.getAttribute('skinWeight') as BufferAttribute;
    this.#positions = geometry.getAttribute('position') as BufferAttribute;
    this.#readPose(source);
    for (let i = 0; i < this.#positions.count; i++) skinPoint(this.#pose,
      [this.#indices.getX(i), this.#indices.getY(i), this.#indices.getZ(i), this.#indices.getW(i)],
      [this.#weights.getX(i), this.#weights.getY(i), this.#weights.getZ(i), this.#weights.getW(i)],
      [this.#positions.getX(i), this.#positions.getY(i), this.#positions.getZ(i)]);
    this.palette = new FramePalette(options.capacity, source.skeleton.bones.length, options.byteBudget);
    const owned = new InstancedBufferGeometry();
    for (const [name, a] of Object.entries(geometry.attributes)) {
      if ('isInterleavedBufferAttribute' in a) throw new Error('Animated instances do not accept interleaved attributes.');
      owned.setAttribute(name, a.clone());
    }
    owned.setIndex(geometry.index?.clone() ?? null); owned.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
    for (const group of geometry.groups) owned.addGroup(group.start, group.count, group.materialIndex);
    owned.instanceCount = 0;
    const arrays = [this.palette.currentBones, this.palette.previousBones, this.palette.currentTransforms, this.palette.previousTransforms];
    this.#buffers = arrays.map((array, i) => {
      const buffer = new StorageBufferAttribute(array, 16);
      owned.setAttribute(`tnPalette${i}`, buffer); return buffer;
    });
    const current = storage(this.#buffers[0], 'mat4', options.capacity * this.palette.bones).toReadOnly();
    const previous = storage(this.#buffers[1], 'mat4', options.capacity * this.palette.bones).toReadOnly();
    const transforms = storage(this.#buffers[2], 'mat4', options.capacity).toReadOnly();
    const oldTransforms = storage(this.#buffers[3], 'mat4', options.capacity).toReadOnly();
    const boneIndex = attribute('skinIndex', 'uvec4'), weight = attribute('skinWeight', 'vec4');
    const base = instanceIndex.mul(this.palette.bones);
    const skin = (palette: typeof current) => palette.element(base.add(boneIndex.x)).mul(weight.x)
      .add(palette.element(base.add(boneIndex.y)).mul(weight.y))
      .add(palette.element(base.add(boneIndex.z)).mul(weight.z))
      .add(palette.element(base.add(boneIndex.w)).mul(weight.w));
    const material = options.material.clone();
    material.positionNode = Fn(() => {
      const matrix = transforms.element(instanceIndex).mul(skin(current));
      normalLocal.assign(matrix.mul(vec4(normalGeometry, 0)).xyz.normalize());
      positionPrevious.assign(oldTransforms.element(instanceIndex).mul(skin(previous)).mul(vec4(positionGeometry, 1)).xyz);
      return matrix.mul(vec4(positionGeometry, 1)).xyz;
    })();
    this.mesh = new Mesh(owned, material); this.mesh.frustumCulled = false;
    const pickGeometry = geometry.clone(); pickGeometry.deleteAttribute('normal');
    this.#pick = new Mesh(pickGeometry, options.material); this.#pick.matrixAutoUpdate = false;
    this.mesh.raycast = (raycaster, hits) => this.#raycast(raycaster, hits);
  }
  #live(): void { if (this.#disposed) throw new Error('Animated instances are disposed.'); }
  #readPose(source: SkinnedMesh): void {
    if (source.geometry !== this.#source.geometry || source.skeleton.bones.length !== this.#source.skeleton.bones.length ||
        source.skeleton.bones.some((bone, i) => bone.name !== this.#source.skeleton.bones[i].name))
      throw new Error('Animated instances must share geometry and bone ordering.');
    source.updateWorldMatrix(true, true); source.updateMatrixWorld(true); source.skeleton.update();
    for (let i = 0; i < source.skeleton.bones.length; i++) {
      this.#matrix.fromArray(source.skeleton.boneMatrices, i * 16)
        .premultiply(source.bindMatrixInverse).multiply(source.bindMatrix);
      rigidScale(this.#matrix); this.#matrix.toArray(this.#pose, i * 16);
    }
  }
  add(source: SkinnedMesh, transform: Matrix4): IInstanceHandle {
    this.#live(); rigidScale(transform); this.#readPose(source); return this.palette.allocate(this.#pose, transform.elements);
  }
  setPose(handle: IInstanceHandle, source: SkinnedMesh): void { this.#live(); this.#readPose(source); this.palette.writePose(handle, this.#pose); }
  setTransform(handle: IInstanceHandle, transform: Matrix4): void { this.#live(); rigidScale(transform); this.palette.writeTransform(handle, transform.elements); }
  remove(handle: IInstanceHandle): void { this.#live(); this.palette.release(handle); }
  prepare(frame: number): IFrameSnapshot {
    this.#live(); const snapshot = this.palette.prepare(frame);
    if (snapshot.frame !== this.#frame.frame) { for (const buffer of this.#buffers) buffer.needsUpdate = true; }
    this.#frame = snapshot; this.mesh.geometry.instanceCount = snapshot.count; return snapshot;
  }
  #raycast(raycaster: Raycaster, hits: Intersection<Object3D>[]): void {
    this.#live(); this.mesh.updateWorldMatrix(true, false); this.#pick.matrixWorld.copy(this.mesh.matrixWorld);
    const position = this.#pick.geometry.getAttribute('position') as BufferAttribute;
    const indices = [0,0,0,0], weights = [0,0,0,0], point = [0,0,0], out = [0,0,0];
    for (let draw = 0; draw < this.#frame.count; draw++) {
      const pose = this.palette.currentBones.subarray(draw * this.#pose.length, (draw + 1) * this.#pose.length);
      this.#matrix.fromArray(this.palette.currentTransforms, draw * 16);
      for (let i = 0; i < position.count; i++) {
        for (let c = 0; c < 4; c++) { indices[c] = this.#indices.getComponent(i,c); weights[c] = this.#weights.getComponent(i,c); }
        for (let c = 0; c < 3; c++) point[c] = this.#positions.getComponent(i,c);
        skinPoint(pose, indices, weights, point, out); this.#point.fromArray(out).applyMatrix4(this.#matrix);
        position.setXYZ(i, this.#point.x, this.#point.y, this.#point.z);
      }
      this.#pick.geometry.computeBoundingBox(); this.#pick.geometry.computeBoundingSphere();
      const found: Intersection[] = []; this.#pick.raycast(raycaster, found);
      for (const hit of found) hits.push(Object.assign(hit, {object: this.mesh, instanceId: this.palette.drawSlots[draw], instanceGeneration: this.palette.drawGenerations[draw]}));
    }
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true; this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.#pick.geometry.dispose(); this.palette.dispose();
  }
}
