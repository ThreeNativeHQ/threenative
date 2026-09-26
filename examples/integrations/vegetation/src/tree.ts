import { Tree } from './vendor/ez-tree.mjs';
import { BufferAttribute, type BufferGeometry, type Group, type Material, Mesh } from 'three';
import { safeIndices } from './geometry.js';
export type TreeOptions = InstanceType<typeof Tree>['options'];
export interface IGeneratedTree { readonly root: Group; readonly vertices: number; dispose(): void; }
interface IRawTree {
  branches: { indices: number[] }; leaves: { indices: number[] };
  branchesMesh: Mesh; leavesMesh: Mesh;
}
function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Tree ${label} must be a nonnegative integer.`);
  return value;
}
function preflight(options: TreeOptions, budget: number): void {
  const levels = count(options.branch.levels,'levels');
  if (levels > 3) throw new Error('Tree authoring currently admits at most four branch levels (0 through 3).');
  const leaves = count(options.leaves.count,'leaf count');
  let branches=1; let upper=0;
  for (let level=0;level<=levels;level++) {
    const sections=count(options.branch.sections[level as 0 | 1 | 2 | 3],'sections'); const segments=count(options.branch.segments[level as 0 | 1 | 2 | 3],'segments');
    if (sections<1 || segments<3) throw new Error('Tree sections must be positive and radial segments at least three.');
    upper += branches * ((sections+1)*(segments+1) + leaves*8);
    if (!Number.isSafeInteger(upper) || upper>budget) throw new Error('Tree estimated vertex count exceeds the authoring budget.');
    if (level<levels) branches *= count(options.branch.children[level as 0 | 1 | 2],'children')+1;
  }
  if ('trellis' in options && options.trellis?.enabled) throw new Error('Trellis geometry is outside this vegetation integration.');
}
function repair(geometry: BufferGeometry, indices: number[], label: string): number {
  if (!Array.isArray(indices)) throw new Error(`Tree donor must expose raw ${label} indices; refusing a possibly truncated buffer.`);
  const position=geometry.getAttribute('position');
  if (!position || position.itemSize!==3) throw new Error(`Tree ${label} positions are invalid.`);
  for (const [name,attribute] of Object.entries(geometry.attributes)) {
    if (attribute.count!==position.count) throw new Error(`Tree ${label}/${name} attribute counts disagree.`);
    for (const value of attribute.array) if (!Number.isFinite(value)) throw new Error(`Tree ${label}/${name} has a non-finite value.`);
  }
  geometry.setIndex(new BufferAttribute(safeIndices(indices,position.count),1));
  if (position.count) { geometry.computeBoundingSphere(); geometry.computeBoundingBox(); }
  return position.count;
}
/** Authoring step: generate a bounded, seeded variant. Do not call this from a game frame loop. */
export function generateTree(options: {
  seed: number; configure: (options: TreeOptions)=>void;
  trunkMaterial: Material; leafMaterial: Material; maxVertices: number;
}): IGeneratedTree {
  if (!Number.isInteger(options.seed) || options.seed<0 || options.seed>0xffffffff) throw new Error('Tree seed must be uint32.');
  count(options.maxVertices,'maxVertices');
  if (options.maxVertices===0) throw new Error('Tree vertex budget must be positive.');
  const tree=new Tree();
  const ownedMaterials=new Set<Material>(); const ownedGeometry=new Set<BufferGeometry>();
  const collect=()=>tree.traverse(object=>{
    if (object instanceof Mesh) {
      ownedGeometry.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        if (material!==options.trunkMaterial && material!==options.leafMaterial) ownedMaterials.add(material);
    }
  });
  try {
    options.configure(tree.options); tree.options.seed=options.seed;
    preflight(tree.options,options.maxVertices); tree.generate(); collect();
    const raw=tree as unknown as IRawTree;
    const vertices=repair(raw.branchesMesh.geometry,raw.branches?.indices,'branches')
      + repair(raw.leavesMesh.geometry,raw.leaves?.indices,'leaves');
    if (vertices>options.maxVertices) throw new Error('Tree generated vertex count exceeds the authoring budget.');
    raw.branchesMesh.material=options.trunkMaterial; raw.leavesMesh.material=options.leafMaterial;
    for (const material of ownedMaterials) material.dispose(); ownedMaterials.clear();
    let disposed=false;
    return {root:tree,vertices,dispose(){ if (!disposed) { disposed=true; for(const geometry of ownedGeometry) geometry.dispose(); ownedGeometry.clear(); } }};
  } catch(error) {
    collect(); for(const geometry of ownedGeometry) geometry.dispose(); for(const material of ownedMaterials) material.dispose();
    throw error;
  }
}
