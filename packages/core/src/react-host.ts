import type { ReactNode } from "react";
import ReactReconciler from "react-reconciler";
import { DiscreteEventPriority, NoEventPriority } from "react-reconciler/constants.js";
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
} from "three";
import type { CanvasLayer } from "./canvas-layer.js";
import { GLYPH_HEIGHT, glyphPixels, supportedGlyphs } from "./react-glyphs.js";
import {
  type ILayoutNode,
  type IOverlayStyle,
  type OverlayColor,
  assertKnownStyle,
  layoutTree,
  textOffset,
} from "./react-layout.js";

/**
 * A React renderer that commits to `CanvasLayer` instead of the DOM.
 *
 * `react` is the component model and has no DOM in it; `react-dom` is one renderer among several,
 * and `react-reconciler` is the supported way to write another. The native host has no DOM to
 * render into and no rasteriser to paint one with, so this maps React elements straight onto
 * Three.js objects inside the orthographic, screen-pixel `CanvasLayer` that `renderOverlay` already
 * draws on every platform. Nothing here imports `react-dom`, which is what keeps
 * `TN_NATIVE_WEB_ONLY_UI` satisfied on a native bundle.
 *
 * There are exactly two element types, and that is the whole vocabulary:
 *
 * - `<view>` — a rectangle. Draws when it has a `background`; otherwise it only positions children.
 * - `<text>` — a run of bitmap glyphs. Its children must be strings or numbers.
 *
 * Anything else throws `TN_REACT_UNKNOWN_ELEMENT` naming the tag. Tailwind class names cannot cross
 * — they are CSS — so styling is the `style` prop, whose supported keys are named exhaustively on
 * `IOverlayStyle` and enforced by `assertKnownStyle`.
 */

/** The two host element types, as strings React sees. Namespaced so no DOM or SVG tag can collide. */
export const VIEW_ELEMENT = "tn-view";
/** @see VIEW_ELEMENT */
export const TEXT_ELEMENT = "tn-text";

type HostKind = "view" | "text";

interface IHostNode extends ILayoutNode {
  readonly kind: HostKind;
  props: Record<string, unknown>;
  /**
   * Every child in commit order, host elements and raw strings alike. React interleaves them
   * (`<text>HP {health}</text>` is two raw nodes), so the order has to survive here even though
   * only the host ones get a box.
   */
  nodes: AnyNode[];
  /** The subset the layout pass walks. Derived from {@link IHostNode.nodes} after each mutation. */
  children: IHostNode[];
  object?: Object3D;
}

interface ITextNode {
  readonly kind: "raw";
  text: string;
  /**
   * React hands `commitTextUpdate` the text instance and nothing else, so a raw node has to know
   * which `<text>` owns it. Without this back-pointer the parent keeps the string it was mounted
   * with, and a HUD counter freezes at its first value while every other signal says it committed.
   */
  parent?: IHostNode;
}

type AnyNode = IHostNode | ITextNode;

interface IContainer {
  readonly root: IHostNode;
  invalidate(): void;
}

const UNIT_PLANE = new PlaneGeometry(1, 1);
const HOST_CONTEXT = {};

function isHost(node: AnyNode): node is IHostNode {
  return node.kind !== "raw";
}

function styleOf(props: Record<string, unknown>, type: string): IOverlayStyle {
  const style = (props.style ?? {}) as IOverlayStyle;
  if (typeof style !== "object")
    throw new Error(`TN_REACT_BAD_STYLE: <${type}> style must be an object.`);
  assertKnownStyle(style, type);
  return style;
}

function makeNode(type: string, props: Record<string, unknown>): IHostNode {
  if (type !== VIEW_ELEMENT && type !== TEXT_ELEMENT) {
    throw new Error(
      `TN_REACT_UNKNOWN_ELEMENT: <${type}> has no native mapping. The native overlay renders <View> and <Text> only; a DOM tag such as <div> or <svg> cannot cross, because there is no DOM and no rasteriser on the native host.`,
    );
  }
  return {
    kind: type === VIEW_ELEMENT ? "view" : "text",
    props,
    style: styleOf(props, type),
    text: "",
    nodes: [],
    children: [],
    box: { x: 0, y: 0, width: 0, height: 0 },
    resolvedFontSize: 14,
  };
}

/** Re-derive a node's drawable children and its own glyph run after its child list changed. */
function reconcileChildren(node: IHostNode): void {
  const children: IHostNode[] = [];
  let text = "";
  for (const child of node.nodes) {
    if (isHost(child)) children.push(child);
    else text += child.text;
  }
  node.children = children;
  node.text = text;
}

function toColor(value: OverlayColor | undefined, fallback: number): Color {
  if (value === undefined) return new Color(fallback);
  return new Color(value as never);
}

/** A `view` paints one quad; a `text` paints one instanced quad per lit glyph pixel. */
function syncObject(node: IHostNode, parent: Group, order: { value: number }): void {
  order.value += 1;
  const renderOrder = 10_000 + order.value;
  if (node.kind === "view") {
    const background = node.style.background;
    if (background === undefined) {
      disposeObject(node);
    } else {
      const mesh = (node.object as Mesh | undefined) ?? newQuad();
      node.object = mesh;
      const material = mesh.material as MeshBasicMaterial;
      material.color.copy(toColor(background, 0xffffff));
      material.opacity = node.style.opacity ?? 1;
      mesh.renderOrder = renderOrder;
      mesh.scale.set(Math.max(node.box.width, 0), Math.max(node.box.height, 0), 1);
      mesh.position.set(node.box.x + node.box.width / 2, -(node.box.y + node.box.height / 2), 0);
      if (mesh.parent !== parent) parent.add(mesh);
    }
  } else {
    syncText(node, parent, renderOrder);
  }
  syncChildren(node.children, parent, order);
}

/** Paint z-indexed siblings as stable subtrees, with every parent background before its children. */
function syncChildren(
  children: readonly IHostNode[],
  parent: Group,
  order: { value: number },
): void {
  const sorted = children
    .map((child, index) => ({ child, index }))
    .sort(
      (left, right) =>
        (left.child.style.zIndex ?? 0) - (right.child.style.zIndex ?? 0) ||
        left.index - right.index,
    );
  for (const { child } of sorted) syncObject(child, parent, order);
}

function newQuad(): Mesh {
  const mesh = new Mesh(
    UNIT_PLANE,
    new MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

function syncText(node: IHostNode, parent: Group, renderOrder: number): void {
  const cell = node.resolvedFontSize / GLYPH_HEIGHT;
  const advance = 6 * cell + (node.style.letterSpacing ?? 0);
  const runs: [number, number][] = [];
  const originX = node.box.x + textOffset(node);
  for (const [index, character] of [...node.text].entries()) {
    const pixels = glyphPixels(character);
    if (pixels === undefined) {
      throw new Error(
        `TN_REACT_UNKNOWN_GLYPH: '${character}' is not in the overlay glyph set, so "${node.text}" would draw with a hole in it. Supported: ${supportedGlyphs()}`,
      );
    }
    for (const [px, py] of pixels) {
      runs.push([originX + index * advance + px * cell, node.box.y + py * cell]);
    }
  }
  const needed = Math.max(runs.length, 1);
  let mesh = node.object as InstancedMesh | undefined;
  if (mesh === undefined || mesh.instanceMatrix.count < needed) {
    disposeObject(node);
    mesh = new InstancedMesh(
      UNIT_PLANE,
      new MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true }),
      // Headroom on purpose: a HUD number goes 30 -> 29 -> 28 all day, and reallocating whenever
      // the pixel count ticks up by one would churn a buffer every second. Grow, never shrink.
      Math.max(needed * 2, 256),
    );
    mesh.frustumCulled = false;
    node.object = mesh;
  }
  const material = mesh.material as MeshBasicMaterial;
  material.color.copy(toColor(node.style.color, 0xffffff));
  material.opacity = node.style.opacity ?? 1;
  mesh.renderOrder = renderOrder;
  const matrix = new Matrix4();
  for (const [index, [x, y]] of runs.entries()) {
    matrix.makeScale(cell, cell, 1);
    matrix.setPosition(x + cell / 2, -(y + cell / 2), 0);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.count = runs.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.parent !== parent) parent.add(mesh);
}

function disposeObject(node: IHostNode): void {
  const object = node.object;
  if (object === undefined) return;
  object.removeFromParent();
  const mesh = object as Mesh;
  (mesh.material as MeshBasicMaterial | undefined)?.dispose();
  node.object = undefined;
}

function disposeTree(node: IHostNode): void {
  disposeObject(node);
  for (const child of node.children) disposeTree(child);
}

let currentPriority: number = NoEventPriority;

/**
 * The host config. Shape and required members come from PRD-216's Phase 0 spike, which paid for
 * the React 19 surprises: `react-reconciler@0.33` has no `prepareUpdate`, and React 19 throws at
 * mount unless `resolveUpdatePriority`, `maySuspendCommit`, `NotPendingTransition` and a
 * `HostTransitionContext` object are present.
 */
const config = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1 as const,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  createInstance: (type: string, props: Record<string, unknown>) => makeNode(type, props),
  createTextInstance: (text: string): ITextNode => ({ kind: "raw", text }),
  shouldSetTextContent: () => false,
  getPublicInstance: (instance: AnyNode) => instance,
  getRootHostContext: () => HOST_CONTEXT,
  getChildHostContext: () => HOST_CONTEXT,

  appendInitialChild: (parent: IHostNode, child: AnyNode) => attach(parent, child),
  appendChild: (parent: IHostNode, child: AnyNode) => attach(parent, child),
  appendChildToContainer: (container: IContainer, child: AnyNode) => attach(container.root, child),
  insertBefore: (parent: IHostNode, child: AnyNode, before: AnyNode) =>
    insert(parent, child, before),
  insertInContainerBefore: (container: IContainer, child: AnyNode, before: AnyNode) =>
    insert(container.root, child, before),
  removeChild: (parent: IHostNode, child: AnyNode) => detach(parent, child),
  removeChildFromContainer: (container: IContainer, child: AnyNode) =>
    detach(container.root, child),
  clearContainer: (container: IContainer) => {
    for (const child of [...container.root.nodes]) detach(container.root, child);
  },
  finalizeInitialChildren: () => false,
  commitUpdate: (
    instance: IHostNode,
    type: string,
    _prev: Record<string, unknown>,
    next: Record<string, unknown>,
  ) => {
    instance.props = next;
    instance.style = styleOf(next, type);
  },
  commitTextUpdate: (instance: ITextNode, _old: string, next: string) => {
    instance.text = next;
    if (instance.parent !== undefined) reconcileChildren(instance.parent);
  },

  prepareForCommit: () => null,
  resetAfterCommit: (container: IContainer) => container.invalidate(),
  preparePortalMount: () => undefined,
  detachDeletedInstance: () => undefined,
  beforeActiveInstanceBlur: () => undefined,
  afterActiveInstanceBlur: () => undefined,
  prepareScopeUpdate: () => undefined,
  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,

  setCurrentUpdatePriority: (priority: number) => {
    currentPriority = priority;
  },
  getCurrentUpdatePriority: () => currentPriority,
  // Discrete, not default, and deliberately so. A default-lane update is handed to React's own
  // Scheduler, which reaches for `MessageChannel` and only falls back to `setTimeout`; on the
  // native host that is one more browser global to depend on for a HUD that has to repaint inside
  // a fixed-step frame anyway. Discrete puts the update on the sync lane, so `flushSyncWork()`
  // from the game loop is all that is ever needed and the overlay never waits on a scheduler.
  resolveUpdatePriority: () =>
    currentPriority !== NoEventPriority ? currentPriority : DiscreteEventPriority,
  getCurrentEventPriority: () => DiscreteEventPriority,

  shouldAttemptEagerTransition: () => false,
  requestPostPaintCallback: () => undefined,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => undefined,
  suspendInstance: () => undefined,
  waitForCommitToBeReady: () => null,
  resetFormInstance: () => undefined,
  trackSchedulerEvent: () => undefined,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  // biome-ignore lint/style/useNamingConvention: exact React reconciler host API name.
  NotPendingTransition: null,
  // biome-ignore lint/style/useNamingConvention: exact React reconciler host API name.
  HostTransitionContext: {
    $$typeof: Symbol.for("react.context"),
    // biome-ignore lint/style/useNamingConvention: exact React context API name.
    Provider: null,
    // biome-ignore lint/style/useNamingConvention: exact React context API name.
    Consumer: null,
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0,
  },
};

function attach(parent: IHostNode, child: AnyNode): void {
  if (!isHost(child)) child.parent = parent;
  parent.nodes.push(child);
  reconcileChildren(parent);
}

function insert(parent: IHostNode, child: AnyNode, before: AnyNode): void {
  if (!isHost(child)) child.parent = parent;
  const at = parent.nodes.indexOf(before);
  parent.nodes.splice(at < 0 ? parent.nodes.length : at, 0, child);
  reconcileChildren(parent);
}

function detach(parent: IHostNode, child: AnyNode): void {
  const at = parent.nodes.indexOf(child);
  if (at >= 0) parent.nodes.splice(at, 1);
  if (isHost(child)) disposeTree(child);
  reconcileChildren(parent);
}

// biome-ignore lint/suspicious/noExplicitAny: react-reconciler's generics are 20 positional slots.
const reconciler = (ReactReconciler as unknown as (config: unknown) => any)(config);

export interface IReactOverlayOptions {
  /** Where the tree is drawn. `ctx.canvasLayer` in a game. */
  canvasLayer: Pick<CanvasLayer, "scene" | "camera" | "onResize">;
  /**
   * Called with any error React could not recover from, before the overlay draws its own named
   * failure banner. The default logs it; nothing swallows it, because a blank HUD and a broken HUD
   * must never look the same.
   */
  onError?: (error: Error) => void;
}

export interface IReactOverlay {
  /** Mount or update the tree. Synchronous, so a caller can assert on the result immediately. */
  render(element: ReactNode): void;
  /** Re-run layout — call after a resize. Cheap and idempotent; it no-ops when nothing moved. */
  refresh(): void;
  /** Unmount the tree and release every Three.js object it created. */
  dispose(): void;
  /** How many Three.js objects the last commit produced. For budgets and tests. */
  readonly objectCount: number;
  /** Number of hook/store updates that changed host nodes during `refresh()`. */
  readonly commitCount: number;
  /** Flush plus draw cost of the latest state-changing `refresh()`, in milliseconds. */
  readonly lastCommitMs: number | undefined;
}

/**
 * Mount React into a `CanvasLayer`.
 *
 * @situation show a React HUD on Android, iOS or desktop native
 * @situation render the same React component on web and on a phone without a WebView
 * @constraint import `react`, never `react-dom`, from a native entry
 * @example const overlay = createReactOverlay({ canvasLayer: ctx.canvasLayer });
 */
export function createReactOverlay(options: IReactOverlayOptions): IReactOverlay {
  const { canvasLayer } = options;
  const group = new Group();
  group.name = "ThreeNativeReactOverlay";
  canvasLayer.scene.add(group);
  const root: IHostNode = {
    kind: "view",
    props: {},
    style: {},
    text: "",
    nodes: [],
    children: [],
    box: { x: 0, y: 0, width: 0, height: 0 },
    resolvedFontSize: 14,
  };
  let dirty = true;
  let lastWidth = 0;
  let lastHeight = 0;
  let objectCount = 0;
  let commitCount = 0;
  let lastCommitMs: number | undefined;
  let failure: { message: string; source: "draw" | "react" } | undefined;
  let failureObject: Object3D | undefined;
  const container: IContainer = {
    root,
    invalidate: () => {
      dirty = true;
    },
  };
  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    failure = { message, source: "react" };
    dirty = true;
    const named = new Error(`TN_REACT_OVERLAY_FAILED: ${message}`);
    if (options.onError !== undefined) options.onError(named);
    else console.error(named.message);
  };
  const fiberRoot = reconciler.createContainer(
    container,
    0,
    null,
    false,
    null,
    "tn",
    report,
    report,
    report,
    null,
  );

  const draw = (): void => {
    const { camera } = canvasLayer;
    const width = camera.right - camera.left;
    const height = camera.top - camera.bottom;
    if (!dirty && width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    dirty = false;
    // Nodes are laid out in screen pixels with the origin top-left and y growing downwards, which
    // is how a HUD is described. The whole group is parked on the camera's top-left corner so that
    // `(x, -y)` on a node is already the right place; nothing below needs to know the viewport.
    group.position.set(-width / 2, height / 2, 0);
    try {
      if (failure?.source === "react") {
        showFailure(failure.message, width);
        return;
      }
      layoutTree(root, width, height);
      const order = { value: 0 };
      syncChildren(root.children, group, order);
      objectCount = order.value;
      failure = undefined;
      clearFailure();
    } catch (error) {
      // A layout or glyph refusal must show as itself, not as an empty screen.
      const message = error instanceof Error ? error.message : String(error);
      failure = { message, source: "draw" };
      if (options.onError !== undefined) options.onError(new Error(message));
      else console.error(message);
      showFailure(message, width);
    }
  };

  const clearFailure = (): void => {
    if (failureObject !== undefined) {
      failureObject.removeFromParent();
      ((failureObject as Mesh).material as MeshBasicMaterial | undefined)?.dispose();
      failureObject = undefined;
    }
    for (const child of group.children) child.visible = true;
  };

  const showFailure = (message: string, width: number): void => {
    clearFailure();
    for (const child of group.children) child.visible = false;
    failureObject = drawFailure(group, message, width);
  };

  const stopResize = canvasLayer.onResize(() => {
    dirty = true;
    draw();
  });

  return {
    render(element: ReactNode) {
      failure = undefined;
      reconciler.updateContainerSync(element, fiberRoot, null, null);
      reconciler.flushSyncWork();
      draw();
    },
    refresh() {
      // A hook that fired outside `render` (a store subscription, a timer) has queued work that
      // nobody has flushed yet. Flushing here is what makes `refresh()` per-frame-safe: with no
      // pending work it is the ~0.4 microseconds Phase 0 measured, and with work it commits it.
      const startedAt = globalThis.performance?.now() ?? Date.now();
      const wasDirty = dirty;
      reconciler.flushSyncWork();
      const committed = dirty && !wasDirty;
      draw();
      if (committed) {
        commitCount += 1;
        lastCommitMs = (globalThis.performance?.now() ?? Date.now()) - startedAt;
      }
    },
    dispose() {
      stopResize();
      reconciler.updateContainerSync(null, fiberRoot, null, null);
      reconciler.flushSyncWork();
      clearFailure();
      disposeTree(root);
      group.removeFromParent();
    },
    get objectCount() {
      return objectCount;
    },
    get commitCount() {
      return commitCount;
    },
    get lastCommitMs() {
      return lastCommitMs;
    },
  };
}

/**
 * The negative control, made visible. When a component throws, the screen shows the error's own
 * first line in red rather than going blank — a blank overlay is indistinguishable from "the UI was
 * never mounted", which is the exact failure this whole PRD exists to end.
 */
function drawFailure(group: Group, message: string, width: number): Object3D | undefined {
  const line = message.split(":")[0] ?? "TN_REACT_OVERLAY_FAILED";
  const node: IHostNode = {
    kind: "text",
    props: {},
    style: { color: "#ff5f4d", fontSize: 18 },
    text: line.slice(0, 48).toUpperCase(),
    nodes: [],
    children: [],
    box: { x: 12, y: 12, width: Math.max(width - 24, 1), height: 18 },
    resolvedFontSize: 18,
  };
  try {
    syncText(node, group, 20_000);
    return node.object;
  } catch {
    // The failure text itself uses a character the font lacks. Nothing further to draw.
    return undefined;
  }
}
