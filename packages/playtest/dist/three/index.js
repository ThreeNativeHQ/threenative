import { Vector2, Vector3, Box3, Matrix4, Frustum } from 'three';

// src/protocol.ts
var PLAYTEST_BRIDGE_GLOBAL = "__THREENATIVE_PLAYTEST_BRIDGE__";
var PLAYTEST_PROTOCOL_VERSION = 1;
var PLAYTEST_PROTOCOL_LIMITS = {
  maxEntitiesPerSample: 100,
  maxEventsPerDrain: 1e3,
  maxPayloadBytes: 1e6,
  operationTimeoutMs: 5e3
};
function assertJsonSafe(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return;
    }
    throw new TypeError(`${path} must contain only finite JSON numbers.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonSafe(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} must be JSON-safe.`);
}

// src/three/entities.ts
var ThreePlaytestEntityRegistry = class {
  #entries = /* @__PURE__ */ new Map();
  register(entry) {
    const path = entry.path ?? objectPath(entry.object);
    const existing = this.#entries.get(entry.id);
    if (existing !== void 0) {
      throw new Error(
        `Duplicate playtest entity id '${entry.id}' conflicts between '${existing.path}' and '${path}'. Register a unique stable id for each observed object.`
      );
    }
    this.#entries.set(entry.id, { ...entry, path });
  }
  get(id) {
    return this.#entries.get(id);
  }
  select(ids) {
    if (ids === void 0) return [...this.#entries.values()];
    return ids.flatMap((id) => {
      const entry = this.#entries.get(id);
      return entry === void 0 ? [] : [entry];
    });
  }
};
function objectPath(object) {
  const parts = [];
  let current = object;
  while (current !== null) {
    parts.unshift(current.name || `${current.type}[${current.uuid.slice(0, 8)}]`);
    current = current.parent;
  }
  return parts.join("/");
}
function sampleThreeObservations(input, request) {
  input.scene.updateMatrixWorld(true);
  input.camera.updateMatrixWorld(true);
  const rendererSize = input.renderer.getDrawingBufferSize(new Vector2());
  const entities = input.registry.select(request.entities).map(({ id, object }) => observeEntity(id, object, input.camera, rendererSize.x, rendererSize.y));
  return {
    clock: {
      mode: input.clockMode,
      ...input.tick === void 0 ? { timeMs: performance.now() } : { tick: input.tick }
    },
    ...input.diagnostics === void 0 ? {} : { diagnostics: input.diagnostics() },
    entities,
    ...input.resources === void 0 ? {} : { resources: input.resources() }
  };
}
function observeEntity(id, object, camera, viewportWidth, viewportHeight) {
  const position = object.getWorldPosition(new Vector3());
  const bounds = projectedBounds(object, camera, viewportWidth, viewportHeight);
  return {
    ...bounds === void 0 ? {} : { bounds },
    id,
    transform: {
      position: [position.x, position.y, position.z],
      rotation: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      scale: [object.scale.x, object.scale.y, object.scale.z]
    },
    visible: object.visible && bounds !== void 0 && bounds.width > 0 && bounds.height > 0
  };
}
function projectedBounds(object, camera, viewportWidth, viewportHeight) {
  const worldBounds = new Box3().setFromObject(object);
  if (worldBounds.isEmpty()) return void 0;
  const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  if (!new Frustum().setFromProjectionMatrix(projection).intersectsBox(worldBounds)) return void 0;
  const min = worldBounds.min;
  const max = worldBounds.max;
  const points = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z)
  ].map((point) => point.project(camera));
  const minX = Math.min(...points.map(({ x }) => x));
  const maxX = Math.max(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxY = Math.max(...points.map(({ y }) => y));
  return {
    height: Math.max(0, (maxY - minY) * 0.5 * viewportHeight),
    width: Math.max(0, (maxX - minX) * 0.5 * viewportWidth),
    x: (minX + 1) * 0.5 * viewportWidth,
    y: (1 - maxY) * 0.5 * viewportHeight
  };
}

// src/three/bridge.ts
function installThreePlaytestBridge(options) {
  const host = globalThis;
  const previous = host[PLAYTEST_BRIDGE_GLOBAL];
  const registry = new ThreePlaytestEntityRegistry();
  options.entities?.forEach((entry) => registry.register(entry));
  let tick = 0;
  const capabilities = [
    "camera.observe",
    "entity.bounds",
    "entity.observe",
    "entity.setup",
    ...options.fixedStep === void 0 ? [] : ["runtime.fixedStep"],
    ...options.resources === void 0 ? [] : ["runtime.resources"],
    ...options.diagnostics === void 0 ? [] : ["runtime.diagnostics"]
  ];
  const bridge = {
    ...options.fixedStep === void 0 ? {} : {
      advance: async (ticks) => {
        if (!Number.isInteger(ticks) || ticks <= 0) throw new Error("advance ticks must be a positive integer.");
        await options.fixedStep(ticks);
        const startTick = tick;
        tick += ticks;
        return { clock: { mode: "fixed-step", tick }, ticks: tick - startTick };
      }
    },
    applySetup: async (request) => applySetup(registry, options.resources, request),
    describe: () => ({
      capabilities,
      limits: PLAYTEST_PROTOCOL_LIMITS,
      name: "@threenative/playtest/three",
      protocolVersion: PLAYTEST_PROTOCOL_VERSION
    }),
    ready: () => ({ ready: true }),
    sample: (request) => sampleThreeObservations({
      camera: options.camera,
      clockMode: options.fixedStep === void 0 ? "render-frame" : "fixed-step",
      diagnostics: options.diagnostics,
      registry,
      renderer: options.renderer,
      resources: options.resources === void 0 ? void 0 : () => options.resources.read(),
      scene: options.scene,
      tick: options.fixedStep === void 0 ? void 0 : tick
    }, request)
  };
  host[PLAYTEST_BRIDGE_GLOBAL] = bridge;
  return {
    bridge,
    dispose: () => {
      if (host[PLAYTEST_BRIDGE_GLOBAL] !== bridge) return;
      if (previous === void 0) delete host[PLAYTEST_BRIDGE_GLOBAL];
      else host[PLAYTEST_BRIDGE_GLOBAL] = previous;
    },
    registerEntity: (entry) => registry.register(entry)
  };
}
function applySetup(registry, resources, request) {
  request.entities?.forEach(({ entity, transform }) => {
    const object = registry.get(entity)?.object;
    if (object === void 0) throw new Error(`Setup entity '${entity}' is not registered.`);
    if (transform.position !== void 0) object.position.fromArray(transform.position);
    if (transform.rotation !== void 0) object.quaternion.fromArray(transform.rotation);
    if (transform.scale !== void 0) object.scale.fromArray(transform.scale);
    object.updateMatrix();
  });
  request.resources?.forEach(({ id, path, value }) => {
    assertJsonSafe(value);
    if (resources?.write === void 0) throw new Error(`Resource setup '${id}' requires a writable resources provider.`);
    if (!resources.write(id, path, value)) throw new Error(`Resource setup '${id}' was rejected by the application provider.`);
  });
}

export { ThreePlaytestEntityRegistry, installThreePlaytestBridge, objectPath, sampleThreeObservations };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map