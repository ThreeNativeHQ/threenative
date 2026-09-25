import { Bone, Quaternion, Vector3 } from 'three';
import { DOF, Goal, Joint, Link, Solver } from 'closed-chain-ik/core';
import { angularError, contactError, uniformScaleOf, validateTargets, type IPoseTarget } from './pose.js';
export interface IJointSpec {
  readonly bone: Bone;
  /** Ordered X/Y/Z rotational offsets relative to the animation pose supplied this frame. */
  readonly axes: readonly ('x' | 'y' | 'z')[];
  readonly min: readonly number[];
  readonly max: readonly number[];
}
export interface IIKOptions {
  readonly root: Bone;
  readonly joints: readonly IJointSpec[];
  readonly effectors: readonly { readonly bone: Bone; readonly orientation?: boolean }[];
  readonly iterations: number;
  readonly positionTolerance: number;
  readonly rotationTolerance: number;
}
export interface IIKResidual { readonly bone: string; readonly metres: number; readonly radians: number | null; }
export interface IIKReport { readonly converged: boolean; readonly solverStatus: readonly number[]; readonly residuals: readonly IIKResidual[]; }
interface IRow { bone: Bone; joint: Joint; link: Link; before: Quaternion; zeros: number[]; }

/** A bridge, not a second skeleton: Three bones remain the only rendered pose. */
export class ConstrainedIK {
  readonly root: Bone;
  readonly #anchor = new Link();
  readonly #rows: IRow[] = [];
  readonly #effectors: { bone: Bone; goal: Goal; orientation: boolean }[] = [];
  readonly #positionTolerance: number;
  readonly #rotationTolerance: number;
  #solver: Solver | null;
  readonly #position = new Vector3();
  readonly #quaternion = new Quaternion();
  readonly #parentQuaternion = new Quaternion();
  readonly #worldQuaternion = [0,0,0,1];

  constructor(options: IIKOptions) {
    this.root = options.root;
    if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 128)
      throw new Error('IK iterations must be an integer from 1 to 128.');
    for (const tolerance of [options.positionTolerance, options.rotationTolerance])
      if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('IK tolerances must be finite and positive.');
    if (!options.effectors.length || !options.joints.length) throw new Error('IK requires joints and effectors.');
    this.#positionTolerance = options.positionTolerance; this.#rotationTolerance = options.rotationTolerance;
    const specifications = new Map<Bone,IJointSpec>();
    for (const specification of options.joints) {
      if (specifications.has(specification.bone)) throw new Error('IK joint appears more than once.');
      const axes = specification.axes;
      if (axes.length !== specification.min.length || axes.length !== specification.max.length || axes.length === 0)
        throw new Error('IK each axis requires a minimum and maximum offset.');
      if (new Set(axes).size !== axes.length || axes.some((a,i) => !['x','y','z'].includes(a) || (i>0 && a<=axes[i-1])))
        throw new Error('IK axes must be unique and in x/y/z order.');
      axes.forEach((_,i) => {
        if (!Number.isFinite(specification.min[i]) || !Number.isFinite(specification.max[i]) || specification.min[i] > specification.max[i])
          throw new Error('IK joint limits must be finite ordered intervals.');
      });
      specifications.set(specification.bone,specification);
    }
    const links = new Map<Bone,Link>();
    const build = (bone: Bone, parent: Link): void => {
      const joint = new Joint(); const link = new Link();
      joint.name = bone.name; link.name = bone.name;
      const specification = specifications.get(bone);
      if (specification) {
        const axes = {x:DOF.EX,y:DOF.EY,z:DOF.EZ};
        joint.setDoF(...specification.axes.map(axis => axes[axis]));
        joint.setMinLimits(...specification.min); joint.setMaxLimits(...specification.max);
      }
      parent.addChild(joint); joint.addChild(link); links.set(bone,link);
      this.#rows.push({bone,joint,link,before:new Quaternion(),zeros:new Array(specification?.axes.length ?? 0).fill(0)});
      for (const child of bone.children) if (child instanceof Bone) build(child,link);
    };
    build(this.root,this.#anchor);
    for (const bone of specifications.keys()) if (!links.has(bone)) throw new Error(`IK joint '${bone.name}' is outside the direct bone hierarchy.`);
    for (const effector of options.effectors) {
      const link = links.get(effector.bone);
      if (!link) throw new Error(`IK effector '${effector.bone.name}' is outside the bone hierarchy.`);
      if (this.#effectors.some(item=>item.bone===effector.bone)) throw new Error('IK effector appears more than once.');
      const goal = new Goal(); const orientation = effector.orientation ?? false;
      if (!orientation) goal.setFreeDoF(DOF.EX,DOF.EY,DOF.EZ);
      goal.makeClosure(link); this.#effectors.push({bone:effector.bone,goal,orientation});
    }
    this.#solver = new Solver(this.#anchor);
    this.#solver.maxIterations = options.iterations;
    this.#solver.useSVD = false;
    this.#solver.translationConvergeThreshold = options.positionTolerance;
    this.#solver.rotationConvergeThreshold = options.rotationTolerance;
  }

  /** Call after AnimationPlayer/mixer and before render; never starts a loop or moves the root. */
  update(targets: readonly IPoseTarget[], blend = 1): IIKReport {
    const solver = this.#solver;
    if (!solver) throw new Error('IK has been disposed.');
    if (!Number.isFinite(blend) || blend < 0 || blend > 1) throw new Error('IK blend must be in [0,1].');
    const goals = validateTargets(targets,this.#effectors.length);
    goals.forEach((target,i)=>{
      if (this.#effectors[i].orientation !== (target.quaternion !== undefined))
        throw new Error('IK target orientation must match its effector contract.');
    });
    this.root.updateWorldMatrix(true,true);
    for (const row of this.#rows) uniformScaleOf(row.bone.matrixWorld.elements);
    const parent = this.root.parent;
    if (parent) {
      uniformScaleOf(parent.matrixWorld.elements);
      parent.getWorldPosition(this.#position); parent.getWorldQuaternion(this.#quaternion);
    } else { this.#position.set(0,0,0); this.#quaternion.identity(); }
    this.#anchor.setPosition(this.#position.x,this.#position.y,this.#position.z);
    this.#anchor.setQuaternion(this.#quaternion.x,this.#quaternion.y,this.#quaternion.z,this.#quaternion.w);
    for (const row of this.#rows) {
      const scale = row.bone.parent ? uniformScaleOf(row.bone.parent.matrixWorld.elements) : 1;
      const p = row.bone.position; const q = row.bone.quaternion;
      angularError(q.toArray(),[0,0,0,1]); row.before.copy(q);
      row.joint.setPosition(p.x*scale,p.y*scale,p.z*scale);
      row.joint.setQuaternion(q.x,q.y,q.z,q.w);
      row.joint.setDoFValues(...row.zeros);
    }
    goals.forEach((target,i)=>{
      const goal=this.#effectors[i].goal;
      goal.setPosition(...target.position);
      if (target.quaternion) goal.setQuaternion(...target.quaternion);
    });
    try {
      const status = solver.solve();
      for (const row of this.#rows) {
        row.link.updateMatrixWorld(); row.link.getWorldQuaternion(this.#worldQuaternion);
        angularError(this.#worldQuaternion,[0,0,0,1]);
        this.#quaternion.fromArray(this.#worldQuaternion).normalize();
        if (row.bone.parent) {
          row.bone.parent.getWorldQuaternion(this.#parentQuaternion);
          this.#quaternion.premultiply(this.#parentQuaternion.invert());
        }
        row.bone.quaternion.copy(row.before).slerp(this.#quaternion,blend);
        row.bone.updateWorldMatrix(false,false);
      }
      this.root.updateWorldMatrix(true,true);
      const residuals = this.#effectors.map((effector,i)=>{
        effector.bone.getWorldPosition(this.#position); effector.bone.getWorldQuaternion(this.#quaternion);
        const target=goals[i];
        return { bone:effector.bone.name, metres:contactError(this.#position.toArray(),target.position),
          radians:target.quaternion ? angularError(this.#quaternion.toArray(),target.quaternion) : null };
      });
      return { solverStatus:status.map(Number), residuals,
        converged:residuals.every(r=>r.metres<=this.#positionTolerance && (r.radians===null || r.radians<=this.#rotationTolerance)) };
    } catch (error) {
      for (const row of this.#rows) row.bone.quaternion.copy(row.before);
      this.root.updateWorldMatrix(true,true); throw error;
    }
  }
  dispose(): void { this.#solver=null; this.#rows.length=0; this.#effectors.length=0; }
}
