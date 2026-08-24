import { Crowd, type CrowdAgent } from "recast-navigation";
import type { Object3D } from "three";
import type { INavigationContext } from "./index.js";
import { finitePositive, toNavigationVector } from "./navigation-utils.js";

export interface INavigationObstacle3DOptions {
  readonly navigation: INavigationContext;
  readonly object: Object3D;
  readonly radius?: number;
  readonly height?: number;
  readonly avoidanceEnabled?: boolean;
}

const MAX_CROWD_AGENTS = 64;
const MAX_CROWD_AGENT_RADIUS = 2;

function crowdFor(navigation: INavigationContext, radius: number): Crowd {
  if (navigation.crowd !== undefined) return navigation.crowd;
  const crowd = new Crowd(navigation.navMesh, {
    maxAgents: MAX_CROWD_AGENTS,
    maxAgentRadius: Math.max(MAX_CROWD_AGENT_RADIUS, radius),
  });
  navigation.crowd = crowd;
  return crowd;
}

export class NavigationObstacle3D {
  readonly navigation: INavigationContext;
  readonly object: Object3D;
  readonly radius: number;
  readonly height: number;
  crowdAgent: CrowdAgent | undefined;
  #avoidanceEnabled: boolean;
  #disposed = false;

  constructor(options: INavigationObstacle3DOptions) {
    if (options.navigation === undefined)
      throw new Error("NavigationObstacle3D requires a navigation context.");
    this.navigation = options.navigation;
    this.object = options.object;
    this.radius = finitePositive("NavigationObstacle3D", "radius", options.radius ?? 0.5);
    this.height = finitePositive("NavigationObstacle3D", "height", options.height ?? 1.4);
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

  // Teleport forces Recast to re-localise on the navmesh; a stationary obstacle pays it once,
  // not per frame. NaN starts make the first sync always localise.
  #lastSyncX = Number.NaN;
  #lastSyncY = Number.NaN;
  #lastSyncZ = Number.NaN;

  syncCrowd(): void {
    if (this.#disposed || this.crowdAgent === undefined) return;
    const { x, y, z } = this.object.position;
    if (x !== this.#lastSyncX || y !== this.#lastSyncY || z !== this.#lastSyncZ) {
      this.#lastSyncX = x;
      this.#lastSyncY = y;
      this.#lastSyncZ = z;
      this.crowdAgent.teleport(toNavigationVector(this.object.position));
      this.crowdAgent.requestMoveVelocity({ x: 0, y: 0, z: 0 });
    }
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
