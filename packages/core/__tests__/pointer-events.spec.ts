import { Group, type Intersection, Mesh, type Object3D, Vector2, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { InputMap } from "../src/input.js";
import {
  type IPointerEvents3DPicker,
  type IPointerState,
  PointerEvents3D,
} from "../src/pointer-events.js";

function pointer(id: number, buttons: number, x: number, y = 0): IPointerState {
  return { buttons, id, position: new Vector2(x, y) };
}

function intersection(object: Object3D, x = 0): Intersection {
  return { distance: 1, object, point: new Vector3(x, 0, 0) } as Intersection;
}

function pickerFor(
  hits: ReadonlyMap<number, Object3D | undefined>,
): IPointerEvents3DPicker & { raycastAll: ReturnType<typeof vi.fn> } {
  const raycastAll = vi.fn(({ screen }: { screen?: Vector2 }) => {
    const object = hits.get(screen?.x ?? 0);
    return object === undefined ? [] : [intersection(object, screen?.x ?? 0)];
  });
  return { raycastAll };
}

describe("PointerEvents3D", () => {
  it("should emit pointerEntered once when the pointer moves onto an object", () => {
    const object = new Mesh();
    const events = new PointerEvents3D();
    const entered = vi.fn();
    events.on(object, "pointerEntered", entered);
    const states = new Map([[1, pointer(1, 0, 10)]]);
    const picker = pickerFor(new Map([[10, object]]));

    events.tick(states, picker);
    events.tick(states, picker);

    expect(entered).toHaveBeenCalledTimes(1);
    expect(entered).toHaveBeenCalledWith(expect.objectContaining({ object, pointerId: 1 }));
    expect(picker.raycastAll).toHaveBeenCalledTimes(2);
  });

  it("should emit pointerExited when the pointer leaves without a new hit", () => {
    const object = new Mesh();
    const events = new PointerEvents3D();
    const exited = vi.fn();
    events.on(object, "pointerExited", exited);
    const states = new Map([[1, pointer(1, 0, 10)]]);
    const hits = new Map<number, Object3D | undefined>([[10, object]]);
    const picker = pickerFor(hits);

    events.tick(states, picker);
    hits.set(10, undefined);
    events.tick(states, picker);

    expect(exited).toHaveBeenCalledTimes(1);
    expect(exited).toHaveBeenCalledWith(expect.objectContaining({ object, pointerId: 1 }));
  });

  it("should track two touch pointers independently", () => {
    const first = new Mesh();
    const second = new Mesh();
    const events = new PointerEvents3D();
    const entered: number[] = [];
    const exited: number[] = [];
    events.on(first, "pointerEntered", ({ pointerId }) => entered.push(pointerId));
    events.on(first, "pointerExited", ({ pointerId }) => exited.push(pointerId));
    events.on(second, "pointerEntered", ({ pointerId }) => entered.push(pointerId));
    events.on(second, "pointerExited", ({ pointerId }) => exited.push(pointerId));
    const hits = new Map<number, Object3D | undefined>([
      [10, first],
      [20, second],
    ]);
    const picker = pickerFor(hits);
    const states = new Map([
      [7, pointer(7, 0, 10)],
      [3, pointer(3, 0, 20)],
    ]);

    events.tick(states, picker);
    hits.set(20, undefined);
    events.tick(states, picker);

    expect(entered).toEqual([7, 3]);
    expect(exited).toEqual([3]);
  });

  it("should raycast zero times when nothing is registered", () => {
    const events = new PointerEvents3D();
    const picker = pickerFor(new Map());

    events.tick(new Map([[1, pointer(1, 0, 10)]]), picker);

    expect(picker.raycastAll).not.toHaveBeenCalled();
  });

  it("should remove a registration and stop raycasting after its disposer runs", () => {
    const object = new Mesh();
    const events = new PointerEvents3D();
    const stop = events.on(object, "pointerEntered", () => undefined);
    const picker = pickerFor(new Map([[10, object]]));

    stop();
    events.tick(new Map([[1, pointer(1, 0, 10)]]), picker);

    expect(picker.raycastAll).not.toHaveBeenCalled();
  });

  it("should deliver a tap on a child to a listener on the loaded root", () => {
    const root = new Group();
    const child = new Mesh();
    root.add(child);
    const events = new PointerEvents3D();
    const tapped = vi.fn();
    events.on(root, "tapped", tapped);
    const states = new Map([[1, pointer(1, 1, 10)]]);
    const picker = pickerFor(new Map([[10, child]]));

    events.tick(states, picker);
    states.set(1, pointer(1, 0, 10));
    events.tick(states, picker);

    expect(tapped).toHaveBeenCalledTimes(1);
    expect(tapped).toHaveBeenCalledWith(expect.objectContaining({ object: child, target: child }));
  });

  it("should stop bubbling when a child listener stops propagation", () => {
    const root = new Group();
    const child = new Mesh();
    root.add(child);
    const events = new PointerEvents3D();
    const rootTapped = vi.fn();
    events.on(child, "tapped", (event) => event.stopPropagation());
    events.on(root, "tapped", rootTapped);
    const states = new Map([[1, pointer(1, 1, 10)]]);
    const picker = pickerFor(new Map([[10, child]]));

    events.tick(states, picker);
    states.set(1, pointer(1, 0, 10));
    events.tick(states, picker);

    expect(rootTapped).not.toHaveBeenCalled();
  });

  it("should keep dragging when the ray leaves the dragged object", () => {
    const object = new Group();
    const child = new Mesh();
    object.add(child);
    const events = new PointerEvents3D();
    const dragged = vi.fn();
    const dragEnded = vi.fn();
    const tapped = vi.fn();
    events.drag(object);
    events.on(object, "dragged", dragged);
    events.on(object, "dragEnded", dragEnded);
    events.on(object, "tapped", tapped);
    const hits = new Map<number, Object3D | undefined>([[10, child]]);
    const picker = pickerFor(hits);
    const states = new Map([[1, pointer(1, 1, 10)]]);

    events.tick(states, picker);
    hits.set(10, undefined);
    events.tick(states, picker);
    states.set(1, pointer(1, 0, 10));
    events.tick(states, picker);

    expect(dragged).toHaveBeenCalledTimes(1);
    expect(dragEnded).toHaveBeenCalledTimes(1);
    expect(tapped).not.toHaveBeenCalled();
  });

  it("should not emit tapped when release happens off the pressed object", () => {
    const object = new Mesh();
    const events = new PointerEvents3D();
    const tapped = vi.fn();
    events.on(object, "tapped", tapped);
    const hits = new Map<number, Object3D | undefined>([[10, object]]);
    const picker = pickerFor(hits);
    const states = new Map([[1, pointer(1, 1, 10)]]);

    events.tick(states, picker);
    hits.set(10, undefined);
    states.set(1, pointer(1, 0, 10));
    events.tick(states, picker);

    expect(tapped).not.toHaveBeenCalled();
  });

  it("should not emit tapped when a pointer disappears off the pressed object", () => {
    const object = new Mesh();
    const events = new PointerEvents3D();
    const tapped = vi.fn();
    events.on(object, "tapped", tapped);
    const hits = new Map<number, Object3D | undefined>([[10, object]]);
    const picker = pickerFor(hits);

    events.tick(new Map([[7, pointer(7, 1, 10)]]), picker);
    hits.set(10, undefined);
    events.tick(new Map(), picker, pointer(7, 0, 20));

    expect(tapped).not.toHaveBeenCalled();
  });

  it("should tap when a pointer disappears on the pressed object", () => {
    const object = new Mesh();
    const events = new PointerEvents3D();
    const tapped = vi.fn();
    events.on(object, "tapped", tapped);
    const picker = pickerFor(new Map([[10, object]]));

    events.tick(new Map([[7, pointer(7, 1, 10)]]), picker);
    events.tick(new Map(), picker, pointer(7, 0, 10));

    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it("should preserve a pointer tap that starts and ends before the next input tick", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    const object = new Mesh();
    const events = new PointerEvents3D();
    const pressed = vi.fn();
    const released = vi.fn();
    const tapped = vi.fn();
    events.on(object, "pointerPressed", pressed);
    events.on(object, "pointerReleased", released);
    events.on(object, "tapped", tapped);
    const picker = pickerFor(new Map([[10, object]]));

    target.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        buttons: 1,
        clientX: 10,
        clientY: 0,
        pointerId: 7,
      }),
    );
    target.dispatchEvent(
      Object.assign(new Event("pointerup"), {
        buttons: 0,
        clientX: 10,
        clientY: 0,
        pointerId: 7,
      }),
    );
    input.tick();
    events.tick(input.raw.pointers, picker, input.raw.pointer, input.raw.pointerEdges);

    expect(pressed).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(1);
    expect(tapped).toHaveBeenCalledTimes(1);
    expect(pressed).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 7 }));
    expect(released).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 7 }));
    expect(tapped).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 7 }));
    input.dispose();
  });
});
