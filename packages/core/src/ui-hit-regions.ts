import { HIT_REGIONS_MESSAGE, type IUiBridge } from "./ui-bridge.js";

/**
 * The interactive-rect registry — how a touch decides whether it belongs to the UI or the game.
 *
 * A web view is a native view with a **rectangular** hit-test region owned by the platform.
 * CSS hit-testing happens inside that surface, after the native view has already claimed the
 * gesture, so `pointer-events: none` does not hand a touch back to the game beneath. It is a
 * useful property inside the page and it is not the pass-through mechanism.
 *
 * The mechanism is this: the page marks its interactive islands with `data-tn-interactive`,
 * this registry publishes where they are, and the native input host does the hit test before
 * either surface sees the gesture.
 *
 * ```tsx
 * <button data-tn-interactive onClick={restart}>Restart</button>
 * ```
 *
 * Three properties make it correct, and each one is a defect this file exists to prevent:
 *
 * - **Published, never queried.** The host owns a snapshot. Asking the page per touch means an
 *   async round trip inside the input path: latency, and a race with the frame that moved it.
 * - **Decided on pointer-down, held to pointer-up.** That rule belongs to the host, because
 *   only the host sees the whole gesture; this file just keeps the snapshot true.
 * - **Republished per frame while a transition is live.** A sliding menu is drawn where the
 *   compositor put it this frame, and a rect published before the slide points at empty space.
 *
 * Rects are **normalized to the viewport**, 0..1, so no host has to know about CSS pixels,
 * device pixel ratio, or the page's zoom to place them on its own surface. That is also what
 * lets a sibling-layer host and an offscreen-texture host read the same payload.
 */

/** One interactive rectangle, normalized to the UI viewport: `0,0` top-left, `1,1` bottom-right. */
export interface IHitRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IHitRegionRegistry {
  /** Recompute and publish now. Called for you; exposed for a game that moves a rect itself. */
  refresh(): void;
  /** The regions as last published. */
  regions(): readonly IHitRegion[];
  /** Stop observing and publish an empty set, so the host stops consuming touches. */
  stop(): void;
}

interface IRegistryOptions {
  /** The connected bridge whose `ui` end publishes the regions. */
  readonly bridge: IUiBridge;
  /** The realm to observe. Defaults to `globalThis`; injected by tests. */
  readonly scope?: Record<string, unknown>;
  /** The marker attribute. Defaults to `data-tn-interactive`; a game should not change it. */
  readonly attribute?: string;
}

/** The attribute a game puts on an element it wants to receive touches. */
export const INTERACTIVE_ATTRIBUTE = "data-tn-interactive";

interface IRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface IElementLike {
  getClientRects?: () => ArrayLike<IRectLike>;
  getBoundingClientRect: () => IRectLike;
}

interface IDocumentLike {
  querySelectorAll: (selector: string) => ArrayLike<IElementLike>;
  documentElement?: { clientWidth?: number; clientHeight?: number };
  addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
  removeEventListener?: (type: string, listener: () => void, options?: unknown) => void;
}

/** Five decimals of a normalized rect is a tenth of a pixel on a 10k display. */
function quantize(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** Events that mean "something is moving and its published rect is now a frame behind". */
const TRANSITION_START = ["transitionrun", "transitionstart", "animationstart"] as const;
const TRANSITION_END = [
  "transitionend",
  "transitioncancel",
  "animationend",
  "animationcancel",
] as const;
/** Events that change layout without changing the DOM, so no observer would fire. */
const LAYOUT_EVENTS = ["resize", "orientationchange", "scroll"] as const;

/**
 * Start publishing interactive rectangles over `bridge`.
 *
 * Fail closed: with no document there is nothing to measure, and a registry that quietly
 * published nothing would look exactly like a UI with no buttons — every touch would fall
 * through to the game and the bug would present as "the button does nothing".
 */
export function publishHitRegions(options: IRegistryOptions): IHitRegionRegistry {
  const scope = (options.scope ?? (globalThis as unknown as Record<string, unknown>)) as Record<
    string,
    unknown
  >;
  const document = scope.document as IDocumentLike | undefined;
  if (document === undefined || typeof document.querySelectorAll !== "function") {
    throw new Error(
      "TN_UI_HIT_REGIONS_NO_DOCUMENT: the interactive-rect registry runs in the UI page and found no document.",
    );
  }
  const selector = `[${options.attribute ?? INTERACTIVE_ATTRIBUTE}]`;
  const bridge = options.bridge;
  if (bridge.end !== "ui") {
    throw new Error(
      `TN_UI_HIT_REGIONS_WRONG_END: hit regions are published by the 'ui' end, not '${bridge.end}'.`,
    );
  }

  let published: readonly IHitRegion[] = [];
  let publishedFrame = "";
  let stopped = false;
  let liveTransitions = 0;
  let frameHandle: number | undefined;

  const viewport = (): { width: number; height: number } => {
    const width =
      (scope.innerWidth as number | undefined) ?? document.documentElement?.clientWidth ?? 0;
    const height =
      (scope.innerHeight as number | undefined) ?? document.documentElement?.clientHeight ?? 0;
    return { width, height };
  };

  /**
   * `getClientRects()` and not `getBoundingClientRect()`: a wrapped inline control is several
   * boxes, and their union covers empty page between them.
   */
  const boxesOf = (element: IElementLike): IRectLike[] => {
    const list = element.getClientRects?.();
    if (list === undefined || list.length === 0) return [element.getBoundingClientRect()];
    const boxes: IRectLike[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const rect = list[index];
      if (rect !== undefined) boxes.push(rect);
    }
    return boxes;
  };

  /**
   * A zero-area box is a hidden element. Publishing it would let the host swallow a touch on a
   * control the player cannot see.
   */
  const normalize = (boxes: readonly IRectLike[], width: number, height: number): IHitRegion[] =>
    boxes
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: quantize(rect.left / width),
        y: quantize(rect.top / height),
        width: quantize(rect.width / width),
        height: quantize(rect.height / height),
      }));

  const measure = (): IHitRegion[] => {
    const { width, height } = viewport();
    if (width <= 0 || height <= 0) return [];
    const regions: IHitRegion[] = [];
    const elements = document.querySelectorAll(selector);
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (element !== undefined) regions.push(...normalize(boxesOf(element), width, height));
    }
    return regions;
  };

  const publish = (regions: readonly IHitRegion[]): void => {
    const frame = JSON.stringify(regions);
    if (frame === publishedFrame) return;
    publishedFrame = frame;
    published = regions;
    bridge.post({ type: HIT_REGIONS_MESSAGE, regions });
  };

  const refresh = (): void => {
    if (stopped) return;
    publish(measure());
  };

  const requestFrame = scope.requestAnimationFrame as
    | ((callback: () => void) => number)
    | undefined;
  const cancelFrame = scope.cancelAnimationFrame as ((handle: number) => void) | undefined;

  /**
   * While anything is transitioning, the published rect is a frame behind wherever the
   * compositor drew it, so this republishes every frame until the last transition ends. It is
   * deliberately not the steady-state path: a HUD that republishes 60 times a second when
   * nothing moved is a message per frame across a process boundary for no reason.
   */
  const pump = (): void => {
    frameHandle = undefined;
    if (stopped || liveTransitions <= 0) return;
    refresh();
    if (requestFrame !== undefined) frameHandle = requestFrame(pump);
  };

  const onTransitionStart = (): void => {
    liveTransitions += 1;
    if (frameHandle === undefined && requestFrame !== undefined) frameHandle = requestFrame(pump);
  };
  const onTransitionEnd = (): void => {
    liveTransitions = Math.max(0, liveTransitions - 1);
    // One last measurement at the resting position: the final frame of a transition can land
    // after the last rAF this pump scheduled.
    refresh();
  };

  const target = document as unknown as {
    addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
    removeEventListener?: (type: string, listener: () => void, options?: unknown) => void;
  };
  const listen = (
    on: "addEventListener" | "removeEventListener",
    host: typeof target,
    types: readonly string[],
    listener: () => void,
  ): void => {
    const method = host[on];
    if (typeof method !== "function") return;
    for (const type of types) method.call(host, type, listener, true);
  };

  listen("addEventListener", target, TRANSITION_START, onTransitionStart);
  listen("addEventListener", target, TRANSITION_END, onTransitionEnd);
  listen("addEventListener", scope as unknown as typeof target, LAYOUT_EVENTS, refresh);

  const MutationObserverCtor = scope.MutationObserver as
    | (new (
        callback: () => void,
      ) => { observe: (t: unknown, o: unknown) => void; disconnect: () => void })
    | undefined;
  const mutations =
    MutationObserverCtor === undefined ? undefined : new MutationObserverCtor(refresh);
  mutations?.observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });

  const ResizeObserverCtor = scope.ResizeObserver as
    | (new (
        callback: () => void,
      ) => { observe: (t: unknown) => void; disconnect: () => void })
    | undefined;
  const resizes = ResizeObserverCtor === undefined ? undefined : new ResizeObserverCtor(refresh);
  if (resizes !== undefined && document.documentElement !== undefined) {
    resizes.observe(document.documentElement);
  }

  refresh();

  return {
    refresh,
    regions: () => published,
    stop() {
      if (stopped) return;
      stopped = true;
      if (frameHandle !== undefined && cancelFrame !== undefined) cancelFrame(frameHandle);
      frameHandle = undefined;
      listen("removeEventListener", target, TRANSITION_START, onTransitionStart);
      listen("removeEventListener", target, TRANSITION_END, onTransitionEnd);
      listen("removeEventListener", scope as unknown as typeof target, LAYOUT_EVENTS, refresh);
      mutations?.disconnect();
      resizes?.disconnect();
      // Publishing the empty set is the point of stopping: a host still holding the last
      // snapshot would keep eating touches over a UI that is gone.
      published = [];
      publishedFrame = "[]";
      bridge.post({ type: HIT_REGIONS_MESSAGE, regions: [] });
    },
  };
}
