import { Crowd, type CrowdAgent, type Vector3 as NavigationVector3 } from "recast-navigation";
import { type Object3D, Vector3 } from "three";
import type { INavigationContext } from "./index.js";

export type NavigationAgentEvent = "targetReached" | "navigationFinished" | "pathChanged";
export type NavigationAgentHandler = () => void;

export interface INavigationAgent3DOptions {
  readonly navigation: INavigationContext;
  readonly object: Object3D;
  readonly radius?: number;
  readonly height?: number;
  readonly maxSpeed?: number;
  readonly pathDesiredDistance?: number;
  readonly targetDesiredDistance?: number;
  readonly avoidanceEnabled?: boolean;
}

const MAX_CROWD_AGENTS = 64;
const MAX_CROWD_AGENT_RADIUS = 2;

function finitePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`NavigationAgent3D ${name} must be finite and positive.`);
  return value;
}

function toNavigationVector(value: Pick<Vector3, "x" | "y" | "z">): NavigationVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function distanceSquared(
  a: Pick<Vector3, "x" | "y" | "z">,
  b: Pick<Vector3, "x" | "y" | "z">,
): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function horizontalDistanceSquared(
  a: Pick<Vector3, "x" | "z">,
  b: Pick<Vector3, "x" | "z">,
): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function navigationPointMatchesTarget(
  point: Pick<Vector3, "x" | "y" | "z">,
  target: Pick<Vector3, "x" | "y" | "z">,
  horizontalLimit: number,
  verticalLimit: number,
): boolean {
  return (
    horizontalDistanceSquared(point, target) <= horizontalLimit ** 2 &&
    Math.abs(point.y - target.y) <= verticalLimit
  );
}

function crowdFor(navigation: INavigationContext, radius: number): Crowd {
  if (navigation.crowd !== undefined) return navigation.crowd;
  const crowd = new Crowd(navigation.navMesh, {
    maxAgents: MAX_CROWD_AGENTS,
    maxAgentRadius: Math.max(MAX_CROWD_AGENT_RADIUS, radius),
  });
  navigation.crowd = crowd;
  return crowd;
}

export class NavigationAgent3D {
  readonly navigation: INavigationContext;
  readonly object: Object3D;
  readonly radius: number;
  readonly height: number;
  readonly maxSpeed: number;
  readonly pathDesiredDistance: number;
  readonly targetDesiredDistance: number;
  #avoidanceEnabled: boolean;
  #target: Vector3 | undefined;
  #path: Vector3[] = [];
  #pathIndex = 0;
  #finished = false;
  #disposed = false;
  #listeners: Record<NavigationAgentEvent, Set<NavigationAgentHandler>> = {
    navigationFinished: new Set(),
    pathChanged: new Set(),
    targetReached: new Set(),
  };
  #crowdAgent: CrowdAgent | undefined;

  constructor(options: INavigationAgent3DOptions) {
    if (options.navigation === undefined)
      throw new Error("NavigationAgent3D requires a navigation context.");
    if (options.navigation.regions.size === 0)
      throw new Error("NavigationAgent3D requires a baked navigation region.");
    this.navigation = options.navigation;
    this.object = options.object;
    this.radius = finitePositive("radius", options.radius ?? 0.35);
    this.height = finitePositive("height", options.height ?? 1.4);
    this.maxSpeed = finitePositive("maxSpeed", options.maxSpeed ?? 4);
    this.pathDesiredDistance = finitePositive(
      "pathDesiredDistance",
      options.pathDesiredDistance ?? 0.35,
    );
    this.targetDesiredDistance = finitePositive(
      "targetDesiredDistance",
      options.targetDesiredDistance ?? 0.45,
    );
    this.#avoidanceEnabled = options.avoidanceEnabled ?? true;
    this.#crowdAgent = undefined;
    if (this.#avoidanceEnabled) this.#enableAvoidance();
    this.navigation.agents.add(this);
  }

  get crowdAgent(): CrowdAgent | undefined {
    return this.#crowdAgent;
  }

  get avoidanceEnabled(): boolean {
    return this.#avoidanceEnabled;
  }

  set avoidanceEnabled(value: boolean) {
    if (this.#disposed || value === this.#avoidanceEnabled) return;
    this.#avoidanceEnabled = value;
    if (value) this.#enableAvoidance();
    else this.#disableAvoidance();
  }

  on(event: NavigationAgentEvent, handler: NavigationAgentHandler): () => void {
    this.#listeners[event].add(handler);
    return () => this.#listeners[event].delete(handler);
  }

  setTargetPosition(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (this.#disposed) throw new Error("NavigationAgent3D cannot target after dispose.");
    if (![position.x, position.y, position.z].every(Number.isFinite))
      throw new Error("NavigationAgent3D target position must be finite.");
    this.#target = new Vector3(position.x, position.y, position.z);
    this.#pathIndex = 0;
    this.#finished = false;
    // One path computation serves both storage and reachability: retargeting used to run
    // computePath twice — once inside isTargetReachable and once to store #path — which doubled
    // the most expensive navigation call for chase AI that retargets every frame.
    const target = this.#target;
    const start = this.navigation.query.findClosestPoint(toNavigationVector(this.object.position));
    const end = this.navigation.query.findClosestPoint(toNavigationVector(target));
    if (!this.#hasEnabledRegion() || !start.success || !end.success) {
      this.#path = [];
      this.#crowdAgent?.resetMoveTarget();
    } else if (start.polyRef === end.polyRef) {
      // Same polygon as today: judged from the closest point, with one computation for storage.
      this.#storeComputedPath(target);
      if (
        !navigationPointMatchesTarget(end.point, target, this.targetDesiredDistance, this.height)
      ) {
        this.#crowdAgent?.resetMoveTarget();
      } else if (this.#path.length > 0) {
        this.#crowdAgent?.requestMoveTarget(toNavigationVector(target));
      }
    } else {
      const reachable = this.#storeComputedPath(target);
      if (!reachable) {
        this.#crowdAgent?.resetMoveTarget();
      } else if (this.#path.length > 0) {
        this.#crowdAgent?.requestMoveTarget(toNavigationVector(target));
      }
    }
    for (const handler of this.#listeners.pathChanged) handler();
  }

  getNextPathPosition(): Vector3 {
    if (this.#target === undefined)
      throw new Error("NavigationAgent3D.getNextPathPosition requires a target position.");
    if (!this.#hasEnabledRegion()) return this.object.position.clone();
    const avoidance = this.#crowdAgent?.desiredVelocityObstacleAdjusted();
    if (this.#path.length === 0) return this.object.position.clone();
    if (avoidance !== undefined && Math.hypot(avoidance.x, avoidance.z) > 0.001) {
      const next = this.object.position.clone();
      next.x += avoidance.x;
      next.z += avoidance.z;
      return next;
    }
    return this.#path[this.#pathIndex]?.clone() ?? this.object.position.clone();
  }

  isNavigationFinished(): boolean {
    return this.#target !== undefined && this.#finished;
  }

  /**
   * Computes the path from the current object position to `target` once, stores it, and reports
   * whether its final waypoint lands within tolerance. The one place both `setTargetPosition`
   * and reachability judgments get their path from.
   */
  #storeComputedPath(target: Vector3): boolean {
    const result = this.navigation.query.computePath(
      toNavigationVector(this.object.position),
      toNavigationVector(target),
    );
    this.#path = result.success
      ? result.path.map((point) => new Vector3(point.x, point.y, point.z))
      : [];
    const final = this.#path.at(-1);
    return (
      result.success &&
      final !== undefined &&
      navigationPointMatchesTarget(final, target, this.targetDesiredDistance, this.height)
    );
  }

  isTargetReachable(position?: Pick<Vector3, "x" | "y" | "z">): boolean {
    const target = position ?? this.#target;
    if (target === undefined) return false;
    const start = this.navigation.query.findClosestPoint(toNavigationVector(this.object.position));
    const end = this.navigation.query.findClosestPoint(toNavigationVector(target));
    if (!this.#hasEnabledRegion() || !start.success || !end.success) return false;
    if (start.polyRef === end.polyRef)
      return navigationPointMatchesTarget(
        end.point,
        target,
        this.targetDesiredDistance,
        this.height,
      );
    const path = this.navigation.query.computePath(
      toNavigationVector(this.object.position),
      toNavigationVector(target),
    );
    const final = path.path.at(-1);
    return (
      path.success &&
      final !== undefined &&
      navigationPointMatchesTarget(final, target, this.targetDesiredDistance, this.height)
    );
  }

  getFinalPosition(): Vector3 {
    return this.#path.at(-1)?.clone() ?? this.object.position.clone();
  }

  distanceToTarget(): number {
    return this.#target === undefined
      ? Number.POSITIVE_INFINITY
      : Math.sqrt(distanceSquared(this.object.position, this.#target));
  }

  // Teleport forces Recast to re-localise the agent on the navmesh, so it is paid only when the
  // object actually moved since the last sync; NaN starts make the first sync always localise.
  #lastSyncX = Number.NaN;
  #lastSyncY = Number.NaN;
  #lastSyncZ = Number.NaN;
  #lastRequestedTarget: Vector3 | undefined;

  syncCrowd(): void {
    if (this.#disposed || this.#crowdAgent === undefined) return;
    const { x, y, z } = this.object.position;
    const moved = x !== this.#lastSyncX || y !== this.#lastSyncY || z !== this.#lastSyncZ;
    const retargeted =
      this.#target !== undefined &&
      this.#target !== this.#lastRequestedTarget &&
      this.#path.length > 0;
    if (!moved && !retargeted) return;
    this.#lastSyncX = x;
    this.#lastSyncY = y;
    this.#lastSyncZ = z;
    if (moved) {
      // Teleport re-localises the agent and drops its move state, so the target is re-sent in
      // the same sync — the pair is atomic, which the every-frame version got by doing both.
      this.#crowdAgent.teleport(toNavigationVector(this.object.position));
    }
    if (this.#target !== undefined && this.#path.length > 0) {
      this.#lastRequestedTarget = this.#target;
      this.#crowdAgent.requestMoveTarget(toNavigationVector(this.#target));
    }
  }

  advance(): void {
    if (
      this.#disposed ||
      this.#target === undefined ||
      this.#path.length === 0 ||
      !this.#hasEnabledRegion()
    )
      return;
    while (this.#pathIndex < this.#path.length - 1) {
      const waypoint = this.#path[this.#pathIndex];
      if (
        waypoint === undefined ||
        horizontalDistanceSquared(this.object.position, waypoint) > this.pathDesiredDistance ** 2
      )
        break;
      this.#pathIndex += 1;
    }
    const reached =
      this.#pathIndex === this.#path.length - 1 &&
      horizontalDistanceSquared(this.object.position, this.#target) <=
        this.targetDesiredDistance ** 2;
    if (!reached || this.#finished) return;
    this.#finished = true;
    for (const handler of this.#listeners.targetReached) handler();
    for (const handler of this.#listeners.navigationFinished) handler();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.navigation.agents.delete(this);
    this.#disableAvoidance();
    for (const listeners of Object.values(this.#listeners)) listeners.clear();
    this.#path = [];
    this.#target = undefined;
  }

  #enableAvoidance(): void {
    if (this.#crowdAgent !== undefined) return;
    const crowd = crowdFor(this.navigation, this.radius);
    this.#crowdAgent = crowd.addAgent(toNavigationVector(this.object.position), {
      collisionQueryRange: 2.5,
      height: this.height,
      maxAcceleration: 20,
      maxSpeed: this.maxSpeed,
      obstacleAvoidanceType: 0,
      pathOptimizationRange: 0,
      radius: this.radius,
      separationWeight: 2,
      updateFlags: 7,
      userData: this,
    });
  }

  #disableAvoidance(): void {
    if (this.#crowdAgent === undefined) return;
    this.navigation.crowd?.removeAgent(this.#crowdAgent);
    this.#crowdAgent = undefined;
  }

  #hasEnabledRegion(): boolean {
    for (const region of this.navigation.regions) if (region.enabled) return true;
    return false;
  }
}
