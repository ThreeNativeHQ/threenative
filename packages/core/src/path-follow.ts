import { CatmullRomCurve3, Vector3 } from "three";

export interface IPathFollow3DOptions {
  readonly loop?: boolean;
  readonly points: readonly Vector3[];
  readonly speed?: number;
}

export interface IPathFollow3DSample {
  readonly point: Vector3;
  readonly progress: number;
  readonly tangent: Vector3;
}

export interface IPathFollow3DProjection {
  readonly distanceFromStart: number;
  readonly lateralDistance: number;
  readonly tangent: Vector3;
  readonly point: Vector3;
  readonly segment: number;
}

const CURVE_DIVISIONS = 128;

/** A portable, distance-based follower for an authored Three.js route. */
export class PathFollow3D {
  readonly curve: CatmullRomCurve3;
  readonly loop: boolean;
  readonly totalLength: number;
  readonly #samples: readonly Vector3[];
  readonly #samplePoint = new Vector3();
  readonly #sampleTangent = new Vector3();
  readonly #tangentStart = new Vector3();
  readonly #tangentEnd = new Vector3();
  readonly #projectPoint = new Vector3();
  readonly #projectTangent = new Vector3();
  #progress = 0;
  #speed: number;

  constructor(options: IPathFollow3DOptions) {
    if (options.points.length < 3) throw new Error("PathFollow3D requires at least three points.");
    if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed < 0))
      throw new Error("PathFollow3D speed must be a finite non-negative number.");
    const points = options.points.map((point) => {
      if (![point.x, point.y, point.z].every(Number.isFinite))
        throw new Error("PathFollow3D points must be finite.");
      return point.clone();
    });
    this.loop = options.loop ?? false;
    this.#speed = options.speed ?? 0;
    this.curve = new CatmullRomCurve3(points, this.loop, "centripetal", 0.5);
    this.totalLength = this.curve.getLengths(CURVE_DIVISIONS).at(-1) ?? 0;
    if (!(this.totalLength > 0)) throw new Error("PathFollow3D requires a positive-length path.");
    const spaced = this.curve.getSpacedPoints(CURVE_DIVISIONS);
    this.#samples = this.loop ? spaced.slice(0, CURVE_DIVISIONS) : spaced;
  }

  get completed(): boolean {
    return !this.loop && this.#progress >= this.totalLength;
  }

  get progress(): number {
    return this.#progress;
  }

  get speed(): number {
    return this.#speed;
  }

  set speed(value: number) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("PathFollow3D speed must be a finite non-negative number.");
    this.#speed = value;
  }

  advance(dt: number, target?: IPathFollow3DSample): IPathFollow3DSample {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("PathFollow3D.advance requires a finite non-negative delta.");
    this.progressTo(this.#progress + this.#speed * dt);
    return this.sample(this.#progress, target);
  }

  progressTo(distance: number): this {
    if (!Number.isFinite(distance) || distance < 0)
      throw new Error("PathFollow3D progress must be a finite non-negative number.");
    this.#progress = this.loop ? distance % this.totalLength : Math.min(distance, this.totalLength);
    return this;
  }

  sample(distance = this.#progress, target?: IPathFollow3DSample): IPathFollow3DSample {
    if (!Number.isFinite(distance) || distance < 0)
      throw new Error("PathFollow3D sample distance must be a finite non-negative number.");
    const progress = this.loop ? distance % this.totalLength : Math.min(distance, this.totalLength);
    const u = progress / this.totalLength;
    if (target !== undefined) {
      this.curve.getPointAt(u, target.point);
      this.#writeTangentAt(u, target.tangent);
      (target as { progress: number }).progress = progress;
      return target;
    }
    this.curve.getPointAt(u, this.#samplePoint);
    this.curve.getTangentAt(u, this.#sampleTangent).normalize();
    return {
      point: this.#samplePoint.clone(),
      progress,
      tangent: this.#sampleTangent.clone(),
    };
  }

  pointAt(distance: number, target?: IPathFollow3DSample): IPathFollow3DSample {
    return this.sample(distance, target);
  }

  project(position: Vector3, target?: IPathFollow3DProjection): IPathFollow3DProjection {
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    )
      throw new Error("PathFollow3D projection position must be finite.");
    let nearest = Number.POSITIVE_INFINITY;
    let nearestIndex = 0;
    for (let index = 0; index < this.#samples.length; index += 1) {
      const sample = this.#samples[index];
      if (sample === undefined) throw new Error("PathFollow3D projection sample is missing.");
      const distance = sample.distanceToSquared(position);
      if (distance < nearest) {
        nearest = distance;
        nearestIndex = index;
      }
    }
    const last = this.#samples.length - 1;
    const segmentCount = this.loop ? this.#samples.length : last;
    const segment = Math.min(nearestIndex, Math.max(0, segmentCount - 1));
    const point = this.#samples[nearestIndex];
    if (point === undefined) throw new Error("PathFollow3D projection sample is missing.");
    const tangentStart = this.#samples[segment];
    if (tangentStart === undefined) throw new Error("PathFollow3D projection tangent is missing.");
    const nextIndex = this.loop
      ? (segment + 1) % this.#samples.length
      : Math.min(segment + 1, last);
    const next = this.#samples[nextIndex];
    if (next === undefined) throw new Error("PathFollow3D projection tangent is missing.");
    const distanceFromSample = (nearestIndex / segmentCount) * this.totalLength;
    const pointTarget = target?.point ?? this.#projectPoint;
    const tangentTarget = target?.tangent ?? this.#projectTangent;
    pointTarget.copy(point);
    tangentTarget.subVectors(next, tangentStart).normalize();
    if (target !== undefined) {
      const output = target as {
        distanceFromStart: number;
        lateralDistance: number;
        segment: number;
      };
      output.distanceFromStart = distanceFromSample;
      output.lateralDistance = point.distanceTo(position);
      output.segment = segment;
      return target;
    }
    return {
      distanceFromStart: distanceFromSample,
      lateralDistance: point.distanceTo(position),
      point: pointTarget.clone(),
      segment,
      tangent: tangentTarget.clone(),
    };
  }

  #writeTangentAt(u: number, target: Vector3): Vector3 {
    const t = this.curve.getUtoTmapping(u, 0);
    const delta = 0.0001;
    let t1 = t - delta;
    let t2 = t + delta;
    if (t1 < 0) t1 = 0;
    if (t2 > 1) t2 = 1;
    this.curve.getPoint(t1, this.#tangentStart);
    this.curve.getPoint(t2, this.#tangentEnd);
    return target.copy(this.#tangentEnd).sub(this.#tangentStart).normalize();
  }
}
