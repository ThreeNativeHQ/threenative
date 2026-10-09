/**
 * three's `uniform(value).value` for both engine back ends (PRD-540). A uniform node keeps the value
 * it was made from: a number is replaced by `.value = x`; a three Color or VectorN stays the same
 * object, so `origin.value.set(x, z)` edits it in place, as Midway's ocean does. `sync()` pushes the
 * edited objects' lanes before a frame draws; a number goes through at once. Either way the engine
 * updates its uniform data and keeps the program.
 */

interface IUniformState {
  value: unknown;
  /** three's `node.update`, set by onRenderUpdate/onFrameUpdate; its result becomes `.value`. */
  update?: (frame: { frameId: number }) => unknown;
}

/** One float per lane: a number, a Color's r, g, b, or a VectorN's x, y, z, w. */
export function uniformLanes(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (typeof v.x === "number" && typeof v.y === "number")
      return [v.x, v.y, v.z, v.w].filter((lane): lane is number => typeof lane === "number");
    if (typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number")
      return [v.r, v.g, v.b];
  }
  throw new TypeError(`TN_TSL_UNIFORM_VALUE: ${String(value)} is not a number, Color or vector`);
}

/**
 * Wraps a back end's `uniform` so each uniform node it returns answers `.value` (an accessor on the
 * node itself: a V8 node has no prototype of its own to carry it) and three's update hooks. `setValues`
 * writes a node's lanes into the engine. `sync()` runs once per render: the update callbacks first,
 * then the edited objects' lanes.
 */
export function liveUniforms<TNode extends object>(
  uniform: (value: unknown) => TNode,
  setValues: (node: TNode, lanes: readonly number[]) => void,
): {
  uniform: (value: unknown) => TNode;
  uniformArray: (
    values: unknown[],
    type?: string,
  ) => { array: unknown[]; element(index: unknown): TNode };
  sync(): void;
} {
  const states = new WeakMap<object, IUniformState>();
  const objects = new Set<WeakRef<TNode>>();
  const updating = new Set<WeakRef<TNode>>();
  let frameId = 0;
  const live = {
    uniform(value: unknown): TNode {
      const node = uniform(value);
      const state: IUniformState = { value };
      states.set(node, state);
      Object.defineProperty(node, "value", {
        configurable: true,
        get: () => state.value,
        set: (next: unknown) => {
          const current = state.value as { copy?: (source: unknown) => unknown } | number;
          // three keeps a Color or VectorN uniform's object and copies into it; a number is replaced.
          if (typeof current === "object" && typeof current.copy === "function") current.copy(next);
          else state.value = next;
          setValues(node, uniformLanes(state.value));
        },
      });
      if (typeof value === "object" && value !== null) objects.add(new WeakRef(node));
      // three's UniformNode.onUpdate: the callback runs with the node as `this` and its result,
      // unless undefined, becomes the value. ponytail: FRAME and RENDER both run once per sync (one
      // per render call); a game that renders twice a frame runs a FRAME callback twice.
      const onUpdate = (
        callback: (this: TNode, frame: unknown, node: TNode) => unknown,
        updateType: string,
      ) => {
        if (updateType !== "frame" && updateType !== "render")
          throw new Error(
            `TN_TSL_UPDATE_UNSUPPORTED: a native uniform updates per frame or render, not per '${updateType}'`,
          );
        if (state.update === undefined) updating.add(new WeakRef(node));
        state.update = (frame) => callback.call(node, frame, node);
        return node;
      };
      Object.defineProperties(node, {
        onUpdate: { configurable: true, value: onUpdate },
        onFrameUpdate: {
          configurable: true,
          value: (callback: never) => onUpdate(callback, "frame"),
        },
        onRenderUpdate: {
          configurable: true,
          value: (callback: never) => onUpdate(callback, "render"),
        },
        onObjectUpdate: {
          configurable: true,
          value: (callback: never) => onUpdate(callback, "object"),
        },
      });
      return node;
    },
    /**
     * three's uniformArray(values): `element(i)` at a constant index is a uniform that reads
     * `values[i]` before each render, as UniformArrayNode copies its array per update. ponytail: a
     * node index needs an engine uniform array; it is refused by name.
     */
    uniformArray(values: unknown[]) {
      if (!Array.isArray(values))
        throw new TypeError("TN_TSL_UNIFORM_ARRAY: uniformArray takes an array");
      const elements = new Map<number, TNode>();
      return {
        array: values,
        element(index: unknown): TNode {
          if (
            typeof index !== "number" ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= values.length
          )
            throw new RangeError(
              `TN_TSL_UNIFORM_ARRAY: element needs a constant index in [0, ${values.length})`,
            );
          let node = elements.get(index);
          if (node === undefined) {
            node = live.uniform(values[index]);
            (
              node as unknown as { onRenderUpdate: (callback: () => unknown) => void }
            ).onRenderUpdate(() => values[index]);
            elements.set(index, node);
          }
          return node;
        },
      };
    },
    sync() {
      const frame = { frameId: ++frameId };
      for (const ref of updating) {
        const node = ref.deref();
        if (node === undefined) {
          updating.delete(ref);
          continue;
        }
        const next = states.get(node)?.update?.(frame);
        if (next !== undefined) (node as { value: unknown }).value = next;
      }
      for (const ref of objects) {
        const node = ref.deref();
        if (node === undefined) {
          objects.delete(ref);
          continue;
        }
        setValues(node, uniformLanes(states.get(node)?.value));
      }
    },
  };
  return live;
}
