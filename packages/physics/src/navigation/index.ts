import type { Ctx, GamePluginHooks } from "@threenative/core";
import { type Crowd, NavMesh, NavMeshQuery, init } from "recast-navigation";
import type { PhysicsContext } from "../plugin.js";
import type { NavigationAgent3D } from "./NavigationAgent3D.js";
import type { NavigationObstacle3D } from "./NavigationObstacle3D.js";
import type { NavigationRegion3D } from "./NavigationRegion3D.js";

export interface NavigationContext {
  navMesh: NavMesh;
  query: NavMeshQuery;
  readonly regions: Set<NavigationRegion3D>;
  readonly agents: Set<NavigationAgent3D>;
  readonly obstacles: Set<NavigationObstacle3D>;
  crowd?: Crowd;
}

export type NavigationPlugin = GamePluginHooks<Record<string, unknown>, PhysicsContext>;

let initialized: Promise<void> | undefined;

function initialize(): Promise<void> {
  initialized ??= init();
  return initialized;
}

function emptyNavigation(): { readonly navMesh: NavMesh; readonly query: NavMeshQuery } {
  const navMesh = new NavMesh();
  const query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
  query.defaultQueryHalfExtents = { x: 2, y: 4, z: 2 };
  return { navMesh, query };
}

function disposeNavigation(navigation: NavigationContext): void {
  for (const obstacle of [...navigation.obstacles]) obstacle.dispose();
  for (const agent of [...navigation.agents]) agent.dispose();
  for (const region of [...navigation.regions]) region.dispose();
  navigation.crowd?.destroy();
  navigation.crowd = undefined;
  navigation.query.destroy();
  navigation.navMesh.destroy();
  navigation.regions.clear();
  navigation.agents.clear();
  navigation.obstacles.clear();
}

export function recast(): NavigationPlugin {
  let navigation: NavigationContext | undefined;
  return {
    setup: async (ctx: Ctx<Record<string, unknown>, PhysicsContext>) => {
      await initialize();
      if (ctx.physics === undefined)
        throw new Error("recast() requires rapier() earlier in the plugins array.");
      const empty = emptyNavigation();
      navigation = {
        agents: new Set(),
        navMesh: empty.navMesh,
        obstacles: new Set(),
        query: empty.query,
        regions: new Set(),
      };
      ctx.physics.navigation = navigation;
      return undefined;
    },
    update: (ctx, dt) => {
      const active = navigation ?? ctx.physics?.navigation;
      if (active === undefined) return;
      for (const obstacle of active.obstacles) obstacle.syncCrowd();
      for (const agent of active.agents) agent.syncCrowd();
      active.crowd?.update(dt);
      for (const agent of active.agents) agent.advance();
    },
    sceneExit: () => {
      if (navigation !== undefined) {
        for (const obstacle of [...navigation.obstacles]) obstacle.dispose();
        for (const agent of [...navigation.agents]) agent.dispose();
        for (const region of [...navigation.regions]) region.dispose();
      }
    },
    dispose: (ctx) => {
      if (navigation !== undefined) disposeNavigation(navigation);
      if (ctx.physics !== undefined) ctx.physics.navigation = undefined;
      navigation = undefined;
    },
  };
}

export { NavigationAgent3D } from "./NavigationAgent3D.js";
export type {
  NavigationAgent3DOptions,
  NavigationAgentEvent,
  NavigationAgentHandler,
} from "./NavigationAgent3D.js";
export { NavigationObstacle3D } from "./NavigationObstacle3D.js";
export type { NavigationObstacle3DOptions } from "./NavigationObstacle3D.js";
export { NavigationRegion3D } from "./NavigationRegion3D.js";
export type { NavigationRegion3DOptions } from "./NavigationRegion3D.js";
