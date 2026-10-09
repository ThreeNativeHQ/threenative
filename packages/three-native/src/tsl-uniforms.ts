/**
 * three's `uniform(value).value` for both engine back ends (PRD-540). A uniform node keeps the value
 * it was made from: a number is replaced by `.value = x`; a three Color or VectorN stays the same
 * object, so `origin.value.set(x, z)` edits it in place, as Midway's ocean does. `sync()` pushes the
 * edited objects' lanes before a frame draws; a number goes through at once. Either way the engine
 * updates its uniform data and keeps the program. `onRenderUpdate(callback)` runs the callback in
 * `sync()`, which each renderer calls once per render, and a value it returns becomes `.value`, as
 * three's UniformNode.onUpdate does.
 */

interface IUniformState {
  value: unknown;
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
 * node itself: a V8 node has no prototype of its own to carry it). `setValues` writes a node's lanes
 * into the engine.
 */
export function liveUniforms<TNode extends object>(
  uniform: (value: unknown) => TNode,
  setValues: (node: TNode, lanes: readonly number[]) => void,
): { uniform: (value: unknown) => TNode; sync(): void } {
  const states = new WeakMap<object, IUniformState>();
  const objects = new Set<WeakRef<TNode>>();
  const updates = new Map<
    WeakRef<TNode>,
    (this: TNode, frame: undefined, node: TNode) => unknown
  >();
  return {
    uniform(value) {
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
      // ponytail: every registered uniform updates on every render, used or not, and the callback
      // gets no NodeFrame; three runs only the uniforms a drawn material reads, with its frame.
      Object.defineProperty(node, "onRenderUpdate", {
        configurable: true,
        value(callback: (this: TNode, frame: undefined, node: TNode) => unknown) {
          updates.set(new WeakRef(node), callback);
          return node;
        },
      });
      if (typeof value === "object" && value !== null) objects.add(new WeakRef(node));
      return node;
    },
    sync() {
      for (const [ref, callback] of updates) {
        const node = ref.deref();
        if (node === undefined) {
          updates.delete(ref);
          continue;
        }
        const next = callback.call(node, undefined, node);
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
}
