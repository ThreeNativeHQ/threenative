/**
 * Where the spans attach to three's own render path.
 *
 * Kept apart from the recorder because they are two different kinds of risk. The recorder is
 * arithmetic over a stack and is proven by unit tests; this file reaches into another library's
 * private methods, and every line of it is a bet about how three 0.185 is shaped. Reading them
 * separately is how the bet stays visible.
 *
 * Every wrapper is an own property on the instance, so it is the object the frame actually uses
 * and uninstalling restores the prototype's method. Three's private methods are read defensively:
 * a renderer whose internals have moved loses that span rather than throwing, and the span simply
 * does not appear in the report — an absent measurement, never a fabricated zero.
 */

import type { Object3D } from "three";
import { SPANS, type SpanId, beginSpan, endSpan, spanRecorder } from "./Spans.js";

/** The render call's span, by what three already calls the scene it was handed. */
function passSpan(scene: unknown, depth: number): SpanId {
  if (depth === 0) return SPANS.mainPass;
  let name = "";
  if (
    typeof scene === "object" &&
    scene !== null &&
    "name" in scene &&
    typeof scene.name === "string"
  ) {
    name = scene.name;
  }
  if (name.startsWith("Shadow Map")) return SPANS.shadowPass;
  if (/reflect/iu.test(name)) return SPANS.reflectionPass;
  return SPANS.nestedPass;
}

/**
 * Gives the render list's `sort` a span, from the first list three hands over.
 *
 * The class is not exported, so the prototype is reached through an instance. Patching the prototype
 * rather than the instance matters: three keeps one list per (scene, camera) pair, and an instance
 * patch would miss every list the game had not drawn with yet.
 */
function patchRenderListSort(list: unknown, restore: (() => void)[]): void {
  if (typeof list !== "object" || list === null) return;
  const prototype: unknown = Object.getPrototypeOf(list);
  if (
    typeof prototype !== "object" ||
    prototype === null ||
    !("sort" in prototype) ||
    typeof prototype.sort !== "function"
  )
    return;
  const originalSort = prototype.sort;
  prototype.sort = function spanSort(this: unknown, ...sortArgs: unknown[]): unknown {
    beginSpan(SPANS.sort);
    try {
      return originalSort.apply(this, sortArgs);
    } finally {
      endSpan(SPANS.sort);
    }
  };
  restore.push(() => {
    prototype.sort = originalSort;
  });
}

/** The slice of the raw three renderer the probes wrap. Structural, so a test can stand in a fake. */
export interface ISpanProbeTarget {
  render(scene: unknown, camera: unknown): unknown;
  _projectObject?(...args: unknown[]): void;
  _renderObjectDirect?(...args: unknown[]): void;
}

/**
 * Wraps the renderer's own render path so each part of a frame lands in its own span.
 *
 * Every wrapper is an own property on the instance, so it is the object the frame actually uses and
 * uninstalling restores the prototype's method. Three's private methods are read defensively: a
 * renderer whose internals have moved loses that span rather than throwing, and the span simply
 * does not appear in the report — an absent measurement, never a fabricated zero.
 *
 * The recursion guards matter: `_projectObject` calls itself once per child, so only the outermost
 * call opens a span, and `render` is deliberately not guarded because a nested render *is* the
 * shadow and reflection passes.
 */
export function installSpanProbes(target: ISpanProbeTarget, root: Object3D): () => void {
  const restore: (() => void)[] = [];
  const previousRender = target.render;
  let renderDepth = 0;
  target.render = function spanRender(this: unknown, scene: unknown, camera: unknown): unknown {
    const id = passSpan(scene, renderDepth);
    renderDepth += 1;
    beginSpan(id);
    try {
      return previousRender.call(this, scene, camera);
    } finally {
      renderDepth -= 1;
      endSpan(id);
    }
  };
  restore.push(() => {
    target.render = previousRender;
  });

  const projectObject = target._projectObject;
  if (typeof projectObject === "function") {
    let projectDepth = 0;
    let listPatched = false;
    target._projectObject = function spanProjectObject(this: unknown, ...args: unknown[]): void {
      if (!listPatched) {
        listPatched = true;
        patchRenderListSort(args[3], restore);
      }
      if (projectDepth > 0) {
        projectObject.apply(this, args);
        return;
      }
      projectDepth += 1;
      beginSpan(SPANS.projectObject);
      try {
        projectObject.apply(this, args);
      } finally {
        projectDepth -= 1;
        endSpan(SPANS.projectObject);
      }
    };
    restore.push(() => {
      target._projectObject = projectObject;
    });
  }

  const renderObjectDirect = target._renderObjectDirect;
  if (typeof renderObjectDirect === "function") {
    target._renderObjectDirect = function spanRenderObjectDirect(
      this: unknown,
      ...args: unknown[]
    ): void {
      beginSpan(SPANS.draw);
      try {
        renderObjectDirect.apply(this, args);
      } finally {
        endSpan(SPANS.draw);
      }
    };
    restore.push(() => {
      target._renderObjectDirect = renderObjectDirect;
    });
  }

  // The walk is patched on the scene's own prototype, not on the root object, because the render
  // phase walks more than one scene: the game's, the projection's mirror, and each shadow and
  // reflection pass's. All of them are Scenes, and a per-object patch would open a span per child
  // of a walk that recurses through every node.
  const scenePrototype: unknown = Object.getPrototypeOf(root);
  if (
    typeof scenePrototype === "object" &&
    scenePrototype !== null &&
    "updateMatrixWorld" in scenePrototype &&
    typeof scenePrototype.updateMatrixWorld === "function"
  ) {
    const sceneUpdate = scenePrototype.updateMatrixWorld;
    let walkDepth = 0;
    scenePrototype.updateMatrixWorld = function spanUpdateMatrixWorld(
      this: Object3D,
      force?: boolean,
    ): void {
      const active = spanRecorder();
      // Only the outermost walk, and only inside the render phase: a walk run from a game's own
      // update tick is not render-phase work, and attributing it here would silently inflate the
      // phase the spans exist to explain.
      if (walkDepth > 0 || active === undefined || active.depth === 0) {
        sceneUpdate.call(this, force);
        return;
      }
      walkDepth += 1;
      beginSpan(SPANS.sceneUpdate);
      try {
        sceneUpdate.call(this, force);
      } finally {
        walkDepth -= 1;
        endSpan(SPANS.sceneUpdate);
      }
    };
    restore.push(() => {
      scenePrototype.updateMatrixWorld = sceneUpdate;
    });
  }

  return () => {
    for (let index = restore.length - 1; index >= 0; index -= 1) restore[index]?.();
  };
}
