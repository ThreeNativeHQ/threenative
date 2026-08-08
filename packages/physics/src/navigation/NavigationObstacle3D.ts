import { Crowd, type CrowdAgent, type Vector3 as NavigationVector3 } from "recast-navigation";
import type { Object3D, Vector3 } from "three";
import type { NavigationContext } from "./index.js";

export interface NavigationObstacle3DOptions {
  readonly navigation: NavigationContext;
  readonly object: Object3D;
  readonly radius?: number;
  readonly height?: number;
  readonly avoidanceEnabled?: boolean;
}

const MAX_CROWD_AGENTS = 64;
const MAX_CROWD_AGENT_RADIUS = 2;

function finitePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`NavigationObstacle3D ${name} must be finite and positive.`);
  return value;
}

function toNavigationVector(value: Pick<Vector3, "x" | "y" | "z">): NavigationVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function crowdFor(navigation: NavigationContext, radius: number): Crowd {
  if (navigation.crowd !== undefined) return navigation.crowd;
  const crowd = new Crowd(navigation.navMesh, {
    maxAgents: MAX_CROWD_AGENTS,
    maxAgentRadius: Math.max(MAX_CROWD_AGENT_RADIUS, radius),
  });
  navigation.crowd = crowd;
  return crowd;
}

export class NavigationObstacle3D {
  readonly navigation: NavigationContext;
  readonly object: Object3D;
  readonly radius: number;
  readonly height: number;
  crowdAgent: CrowdAgent | undefined;
  #avoidanceEnabled: boolean;
  #disposed = false;

  constructor(options: NavigationObstacle3DOptions) {
    if (options.navigation === undefined)
      throw new Error("NavigationObstacle3D requires a navigation context.");
    this.navigation = options.navigation;
    this.object = options.object;
    this.radius = finitePositive("radius", options.radius ?? 0.5);
    this.height = finitePositive("height", options.height ?? 1.4);
    this.#avoidanceEnabled = options.avoidanceEnabled ?? true;
    this.navigation.obstacles.add(this);
    if (this.#avoidanceEnabled) this.#enableAvoidance();
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

  syncCrowd(): void {
    if (this.#disposed || this.crowdAgent === undefined) return;
    this.crowdAgent.teleport(toNavigationVector(this.object.position));
    this.crowdAgent.requestMoveVelocity({ x: 0, y: 0, z: 0 });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disableAvoidance();
    this.navigation.obstacles.delete(this);
  }

  #enableAvoidance(): void {
    if (this.crowdAgent !== undefined) return;
    const crowd = crowdFor(this.navigation, this.radius);
    this.crowdAgent = crowd.addAgent(toNavigationVector(this.object.position), {
      collisionQueryRange: this.radius * 4,
      height: this.height,
      maxAcceleration: 0,
      maxSpeed: 0,
      obstacleAvoidanceType: 0,
      pathOptimizationRange: 0,
      radius: this.radius,
      separationWeight: 0,
      updateFlags: 7,
      userData: this,
    });
    this.crowdAgent.requestMoveVelocity({ x: 0, y: 0, z: 0 });
  }

  #disableAvoidance(): void {
    if (this.crowdAgent === undefined) return;
    this.navigation.crowd?.removeAgent(this.crowdAgent);
    this.crowdAgent = undefined;
  }
}
