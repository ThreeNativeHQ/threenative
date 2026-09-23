import { type Intersection, type Object3D, Vector2, Vector3 } from "three";
import type { IRawInputPointerEdge } from "./input.js";
import type { IRaycastOptions, ScenePicker } from "./picking.js";

export const POINTER_EVENT_TYPES = [
  "pointerEntered",
  "pointerExited",
  "pointerPressed",
  "pointerReleased",
  "tapped",
  "dragStarted",
  "dragged",
  "dragEnded",
] as const;

export type PointerEvent3DType = (typeof POINTER_EVENT_TYPES)[number];

export interface IPointerState {
  readonly id: number;
  readonly buttons: number;
  readonly position: Vector2;
}

export interface IPointerEvent3D {
  readonly buttons: number;
  readonly intersection: Intersection | undefined;
  readonly object: Object3D;
  readonly point: Vector3;
  readonly pointerId: number;
  readonly target: Object3D;
  readonly type: PointerEvent3DType;
  stopPropagation(): void;
}

export type PointerEvent3DListener = (event: IPointerEvent3D) => void;

export interface IPointerDragHandle {
  cancel(): void;
}

export interface IPointerEvents3DPicker {
  raycastAll(options?: IRaycastOptions): readonly Intersection[];
}

export interface IPointerEvents3D {
  on(object: Object3D, type: PointerEvent3DType, listener: PointerEvent3DListener): () => void;
  off(object: Object3D, type: PointerEvent3DType, listener: PointerEvent3DListener): void;
  drag(object: Object3D): IPointerDragHandle;
}

export interface IPointerEvents3DOptions {
  /** Convert an input position into the canvas-relative pixels expected by ScenePicker. */
  readonly screen?: (position: Vector2, target: Vector2) => Vector2;
}

interface IPointerRecord {
  readonly id: number;
  buttons: number;
  dragTarget: Object3D | undefined;
  hovered: Object3D | undefined;
  lastPoint: Vector3;
  pressed: Object3D | undefined;
}

type PrimaryPointer = Pick<IPointerState, "buttons" | "position">;
type PointerEdge = IRawInputPointerEdge;
type PointerEdges = ReadonlyMap<number, readonly PointerEdge[]>;
type PointerPicker = Pick<ScenePicker, "raycastAll"> | IPointerEvents3DPicker;

const NO_POINT = new Vector3();

function isPointerEventType(value: string): value is PointerEvent3DType {
  return (POINTER_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Dispatch portable pointer events from the input stream to registered Three.js objects.
 *
 * Listeners live in a side table, so this never patches Three.js prototypes. The picker receives
 * one target list and one query per active pointer, while the empty registration path does no
 * queries at all.
 */
export class PointerEvents3D implements IPointerEvents3D {
  #listeners = new Map<Object3D, Map<PointerEvent3DType, Set<PointerEvent3DListener>>>();
  #draggable = new Set<Object3D>();
  #edgeHits = new Map<number, Intersection | undefined>();
  #pointers = new Map<number, IPointerRecord>();
  #edgeIds = new Set<number>();
  #targets: Object3D[] = [];
  #screen = new Vector2();
  #screenTransform: (position: Vector2, target: Vector2) => Vector2;

  constructor(options: IPointerEvents3DOptions = {}) {
    this.#screenTransform = options.screen ?? ((position, target) => target.copy(position));
  }

  /** Listen for one event on an object. The returned function removes exactly this listener. */
  on(object: Object3D, type: PointerEvent3DType, listener: PointerEvent3DListener): () => void {
    if (!isPointerEventType(type)) throw new Error(`Unknown 3D pointer event '${type}'.`);
    let byType = this.#listeners.get(object);
    if (byType === undefined) {
      byType = new Map();
      this.#listeners.set(object, byType);
      this.#addTarget(object);
    }
    let listeners = byType.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      byType.set(type, listeners);
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.off(object, type, listener);
    };
  }

  /** Remove a listener previously passed to `on`. */
  off(object: Object3D, type: PointerEvent3DType, listener: PointerEvent3DListener): void {
    const byType = this.#listeners.get(object);
    const listeners = byType?.get(type);
    if (byType === undefined || listeners === undefined) return;
    listeners.delete(listener);
    if (listeners.size !== 0) return;
    byType.delete(type);
    this.#unregisterIfUnused(object);
  }

  /** Make an object capture a pointer for drag events until its handle is cancelled. */
  drag(object: Object3D): IPointerDragHandle {
    this.#draggable.add(object);
    this.#addTarget(object);
    let active = true;
    return {
      cancel: () => {
        if (!active) return;
        active = false;
        this.#draggable.delete(object);
        for (const record of this.#pointers.values()) {
          if (record.dragTarget !== object) continue;
          this.#dispatch("dragEnded", object, record, record.buttons, undefined);
          record.dragTarget = undefined;
          record.pressed = undefined;
        }
        this.#unregisterIfUnused(object);
      },
    };
  }

  /**
   * Advance every pointer by one simulation tick.
   *
   * `primary` is the legacy mouse position: InputMap keeps it even when no button is down, which
   * lets hover work on web without changing the existing held-touch map. It is ignored whenever
   * the per-id map has a live pointer.
   */
  tick(
    pointers: ReadonlyMap<number, IPointerState>,
    picker: PointerPicker,
    primary?: PrimaryPointer,
    edges?: PointerEdges,
  ): void {
    this.#edgeIds.clear();
    this.#edgeHits.clear();
    if (this.#targets.length === 0) return;
    const active = new Map<number, IPointerState>();
    for (const [id, pointer] of pointers) active.set(id, pointer);
    const hasEdges = edges !== undefined && edges.size !== 0;
    if (!hasEdges && active.size === 0 && primary !== undefined) {
      const onlyPointer =
        this.#pointers.size === 1 ? this.#pointers.keys().next().value : undefined;
      const id = onlyPointer ?? 0;
      active.set(id, { id, buttons: primary.buttons, position: primary.position });
    }

    if (edges !== undefined) {
      for (const id of edges.keys()) this.#edgeIds.add(id);
    }
    for (const [id, record] of this.#pointers) {
      if (active.has(id) || this.#edgeIds.has(id)) continue;
      this.#finishPointer(id, record);
    }

    this.#processEdges(picker, edges);
    if (active.size === 0 && primary !== undefined) {
      const onlyPointer =
        this.#pointers.size === 1 ? this.#pointers.keys().next().value : undefined;
      const id = onlyPointer ?? 0;
      active.set(id, { id, buttons: primary.buttons, position: primary.position });
    }
    for (const [id, record] of this.#pointers) {
      if (active.has(id) || this.#edgeIds.has(id)) continue;
      this.#finishPointer(id, record);
    }

    for (const [id, pointer] of active) {
      this.#processActive(pointer, picker, this.#edgeIds.has(id));
    }
  }

  /** Remove all registrations and release all per-pointer state, usually on scene change. */
  clear(): void {
    this.#listeners.clear();
    this.#draggable.clear();
    this.#edgeHits.clear();
    this.#edgeIds.clear();
    this.#pointers.clear();
    this.#targets.length = 0;
  }

  dispose(): void {
    this.clear();
  }

  #newRecord(id: number): IPointerRecord {
    return {
      buttons: 0,
      dragTarget: undefined,
      hovered: undefined,
      id,
      lastPoint: NO_POINT.clone(),
      pressed: undefined,
    };
  }

  #hit(pointer: IPointerState, picker: PointerPicker): Intersection | undefined {
    this.#screenTransform(pointer.position, this.#screen);
    const hits = picker.raycastAll({ screen: this.#screen, targets: this.#targets });
    return hits[0];
  }

  #processEdges(picker: PointerPicker, edges: PointerEdges | undefined): void {
    if (edges === undefined) return;
    for (const [id, pointerEdges] of edges) {
      this.#edgeIds.add(id);
      for (const edge of pointerEdges) {
        const hit = this.#hit(edge, picker);
        this.#edgeHits.set(id, hit);
        this.#processEdge(edge, hit);
      }
    }
  }

  #processEdge(edge: PointerEdge, hit: Intersection | undefined): void {
    const record = this.#pointers.get(edge.id) ?? this.#newRecord(edge.id);
    this.#pointers.set(edge.id, record);
    this.#edgeHits.set(edge.id, hit);
    this.#updateHover(record, hit, edge.buttons);
    if (edge.type === "down") {
      if (record.buttons === 0 && edge.buttons !== 0) this.#press(record, hit, edge.buttons);
    } else if (edge.type === "up" && record.buttons !== 0 && edge.buttons === 0) {
      this.#release(record, hit, edge.buttons);
    } else if (edge.type === "cancel") {
      this.#cancel(record);
    }
    record.buttons = edge.type === "cancel" ? 0 : edge.buttons;
  }

  #processActive(pointer: IPointerState, picker: PointerPicker, hasEdge: boolean): void {
    const record = this.#pointers.get(pointer.id) ?? this.#newRecord(pointer.id);
    this.#pointers.set(pointer.id, record);
    const previousButtons = record.buttons;
    const hit = hasEdge ? this.#edgeHits.get(pointer.id) : this.#hit(pointer, picker);
    this.#updateHover(record, hit, pointer.buttons);
    if (!hasEdge) {
      if (previousButtons === 0 && pointer.buttons !== 0) {
        this.#press(record, hit, pointer.buttons);
      } else if (pointer.buttons !== 0 && record.dragTarget !== undefined) {
        this.#dispatch("dragged", record.dragTarget, record, pointer.buttons, hit);
      }
      if (previousButtons !== 0 && pointer.buttons === 0)
        this.#release(record, hit, pointer.buttons);
    }
    record.buttons = pointer.buttons;
  }

  #press(record: IPointerRecord, hit: Intersection | undefined, buttons: number): void {
    record.pressed = hit?.object;
    if (record.pressed === undefined) return;
    this.#dispatch("pointerPressed", record.pressed, record, buttons, hit);
    record.dragTarget = this.#draggableAncestor(record.pressed);
    if (record.dragTarget !== undefined)
      this.#dispatch("dragStarted", record.dragTarget, record, buttons, hit);
  }

  #cancel(record: IPointerRecord): void {
    record.pressed = undefined;
    record.dragTarget = undefined;
    if (record.hovered === undefined) return;
    this.#dispatch("pointerExited", record.hovered, record, 0, undefined);
    record.hovered = undefined;
  }

  #updateHover(record: IPointerRecord, hit: Intersection | undefined, buttons: number): void {
    const next = hit?.object;
    if (record.hovered === next) {
      if (hit !== undefined) record.lastPoint.copy(hit.point);
      return;
    }
    if (record.hovered !== undefined)
      this.#dispatch("pointerExited", record.hovered, record, buttons, undefined);
    record.hovered = next;
    if (hit !== undefined) {
      record.lastPoint.copy(hit.point);
      this.#dispatch("pointerEntered", hit.object, record, buttons, hit);
    }
  }

  #release(
    record: IPointerRecord,
    hit: Intersection | undefined,
    buttons: number,
    allowTap = true,
  ): void {
    const pressed = record.pressed;
    if (pressed === undefined) return;
    this.#dispatch("pointerReleased", pressed, record, buttons, hit);
    const dragTarget = record.dragTarget;
    if (dragTarget !== undefined) {
      this.#dispatch("dragEnded", dragTarget, record, buttons, hit);
    } else if (allowTap && this.#sameInteractiveTarget(pressed, hit?.object ?? record.hovered)) {
      this.#dispatch("tapped", pressed, record, buttons, hit);
    }
    record.pressed = undefined;
    record.dragTarget = undefined;
  }

  #finishPointer(id: number, record: IPointerRecord): void {
    if (record.buttons !== 0) this.#release(record, undefined, 0, false);
    if (record.hovered !== undefined) {
      this.#dispatch("pointerExited", record.hovered, record, 0, undefined);
      record.hovered = undefined;
    }
    this.#pointers.delete(id);
  }

  #dispatch(
    type: PointerEvent3DType,
    target: Object3D,
    record: IPointerRecord,
    buttons: number,
    hit: Intersection | undefined,
  ): void {
    let stopped = false;
    const event: IPointerEvent3D = {
      buttons,
      intersection: hit,
      object: target,
      point: (hit?.point ?? record.lastPoint).clone(),
      pointerId: record.id,
      target,
      type,
      stopPropagation: () => {
        stopped = true;
      },
    };
    let current: Object3D | null = target;
    while (current !== null) {
      const listeners = this.#listeners.get(current)?.get(type);
      if (listeners !== undefined) {
        for (const listener of [...listeners]) listener(event);
      }
      if (stopped) return;
      current = current.parent;
    }
  }

  #draggableAncestor(object: Object3D): Object3D | undefined {
    let current: Object3D | null = object;
    while (current !== null) {
      if (this.#draggable.has(current)) return current;
      current = current.parent;
    }
    return undefined;
  }

  #sameInteractiveTarget(first: Object3D, second: Object3D | undefined): boolean {
    if (second === undefined) return false;
    return this.#interactiveTarget(first) === this.#interactiveTarget(second);
  }

  #interactiveTarget(object: Object3D): Object3D | undefined {
    let current: Object3D | null = object;
    while (current !== null) {
      if (this.#listeners.has(current) || this.#draggable.has(current)) return current;
      current = current.parent;
    }
    return undefined;
  }

  #addTarget(object: Object3D): void {
    if (!this.#targets.includes(object)) this.#targets.push(object);
  }

  #unregisterIfUnused(object: Object3D): void {
    const byType = this.#listeners.get(object);
    if (byType !== undefined && byType.size !== 0) return;
    if (this.#draggable.has(object)) return;
    this.#listeners.delete(object);
    const index = this.#targets.indexOf(object);
    if (index >= 0) this.#targets.splice(index, 1);
  }
}
