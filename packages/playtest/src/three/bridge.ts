import {
  PLAYTEST_BRIDGE_GLOBAL,
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  assertJsonSafe,
  type IPlaytestBridgeHost,
  type IPlaytestBridgeV1,
  type IPlaytestSetupRequest,
  type JsonValue,
} from "../protocol.js";
import type { Camera, Scene } from "three";

import { ThreePlaytestEntityRegistry, type IThreePlaytestEntity } from "./entities.js";
import { sampleThreeObservations, type ThreePlaytestRenderer } from "./observations.js";

export interface IThreePlaytestResources {
  read(): Record<string, JsonValue>;
  write?(id: string, path: string | undefined, value: JsonValue): boolean;
}

export interface IThreePlaytestBridgeOptions {
  camera: Camera;
  diagnostics?: () => JsonValue[];
  entities?: readonly IThreePlaytestEntity[] | (() => readonly IThreePlaytestEntity[]);
  fixedStep?: (ticks: number) => Promise<void> | void;
  renderer: ThreePlaytestRenderer;
  resources?: IThreePlaytestResources;
  scene: Scene;
}

export interface IThreePlaytestBridgeInstallation {
  bridge: IPlaytestBridgeV1;
  dispose(): void;
  registerEntity(entry: IThreePlaytestEntity): void;
  syncEntities(): void;
}

export function installThreePlaytestBridge(options: IThreePlaytestBridgeOptions): IThreePlaytestBridgeInstallation {
  const host = globalThis as IPlaytestBridgeHost;
  const previous = host[PLAYTEST_BRIDGE_GLOBAL];
  const registry = new ThreePlaytestEntityRegistry();
  syncEntities(registry, options.entities);
  let tick = 0;
  const capabilities = [
    "camera.observe",
    "entity.bounds",
    "entity.observe",
    "entity.setup",
    ...(options.fixedStep === undefined ? [] : ["runtime.fixedStep"]),
    ...(options.resources === undefined ? [] : ["runtime.resources"]),
    ...(options.diagnostics === undefined ? [] : ["runtime.diagnostics"]),
  ];
  const bridge: IPlaytestBridgeV1 = {
    ...(options.fixedStep === undefined
      ? {}
      : {
          advance: async (ticks) => {
            if (!Number.isInteger(ticks) || ticks <= 0) throw new Error("advance ticks must be a positive integer.");
            await options.fixedStep!(ticks);
            const startTick = tick;
            tick += ticks;
            return { clock: { mode: "fixed-step" as const, tick }, ticks: tick - startTick };
          },
        }),
    applySetup: async (request) => applySetup(registry, options.resources, request),
    describe: () => ({
      capabilities,
      limits: PLAYTEST_PROTOCOL_LIMITS,
      name: "@threenative/playtest/three",
      protocolVersion: PLAYTEST_PROTOCOL_VERSION,
    }),
    ready: () => ({ ready: true }),
    sample: (request) => {
      syncEntities(registry, options.entities);
      return sampleThreeObservations({
        camera: options.camera,
        clockMode: options.fixedStep === undefined ? "render-frame" : "fixed-step",
        diagnostics: options.diagnostics,
        registry,
        renderer: options.renderer,
        resources: options.resources === undefined ? undefined : () => options.resources!.read(),
        scene: options.scene,
        tick: options.fixedStep === undefined ? undefined : tick,
      }, request);
    },
  };
  host[PLAYTEST_BRIDGE_GLOBAL] = bridge;
  return {
    bridge,
    dispose: () => {
      if (host[PLAYTEST_BRIDGE_GLOBAL] !== bridge) return;
      if (previous === undefined) delete host[PLAYTEST_BRIDGE_GLOBAL];
      else host[PLAYTEST_BRIDGE_GLOBAL] = previous;
    },
    registerEntity: (entry) => registry.register(entry),
    syncEntities: () => syncEntities(registry, options.entities),
  };
}

function syncEntities(
  registry: ThreePlaytestEntityRegistry,
  entities: IThreePlaytestBridgeOptions["entities"],
): void {
  if (entities === undefined) return;
  registry.replace(typeof entities === "function" ? entities() : entities);
}

function applySetup(
  registry: ThreePlaytestEntityRegistry,
  resources: IThreePlaytestResources | undefined,
  request: IPlaytestSetupRequest,
): void {
  request.entities?.forEach(({ entity, transform }) => {
    const object = registry.get(entity)?.object;
    if (object === undefined) throw new Error(`Setup entity '${entity}' is not registered.`);
    if (transform.position !== undefined) object.position.fromArray(transform.position);
    if (transform.rotation !== undefined) object.quaternion.fromArray(transform.rotation);
    if (transform.scale !== undefined) object.scale.fromArray(transform.scale);
    object.updateMatrix();
  });
  request.resources?.forEach(({ id, path, value }) => {
    assertJsonSafe(value);
    if (resources?.write === undefined) throw new Error(`Resource setup '${id}' requires a writable resources provider.`);
    if (!resources.write(id, path, value)) throw new Error(`Resource setup '${id}' was rejected by the application provider.`);
  });
}
