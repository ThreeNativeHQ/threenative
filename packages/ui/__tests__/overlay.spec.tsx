import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugOverlay, type DebugSnapshot } from "../src/DebugOverlay.js";

type Listener = (event: KeyboardEvent) => void;

function installDevWindow(snapshot: () => DebugSnapshot) {
  const listeners = new Set<Listener>();
  const windowLike = {
    __THREENATIVE__: { snapshot },
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener as Listener);
    },
    clearInterval,
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as Listener);
    },
    setInterval,
  } as unknown as Window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowLike });
  return {
    toggle: () => {
      for (const listener of listeners) listener({ key: "`" } as KeyboardEvent);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "window");
});

describe("DebugOverlay", () => {
  it("renders one row per registered entity field", () => {
    vi.useFakeTimers();
    const controls = installDevWindow(() => ({
      player: { hull: 100, position: [0, 1, 2] },
      pickup: { active: true, value: 1 },
    }));
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<DebugOverlay />);
    });
    act(() => {
      controls.toggle();
      vi.advanceTimersByTime(100);
    });

    expect(renderer.root.findAllByType("tbody")[0]?.findAllByType("tr")).toHaveLength(4);
    const overlay = renderer.root.findByProps({ "data-threenative-debug-overlay": "true" });
    expect(overlay.props.style).toBeUndefined();
    expect(overlay.findByType("table").props.style).toBeUndefined();
    act(() => renderer.unmount());
  });

  it("polls at most 11 times per second", () => {
    vi.useFakeTimers();
    const snapshot = vi.fn(() => ({ player: { hull: 100 } }));
    const controls = installDevWindow(snapshot);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<DebugOverlay />);
    });
    act(() => {
      controls.toggle();
      vi.advanceTimersByTime(1_000);
    });

    expect(snapshot.mock.calls.length).toBeLessThanOrEqual(11);
    act(() => renderer.unmount());
  });

  it("stays empty while the devtools snapshot is replaced", () => {
    vi.useFakeTimers();
    const controls = installDevWindow(() => ({ player: { hull: 100 } }));
    (globalThis.window as unknown as { __THREENATIVE__?: unknown }).__THREENATIVE__ = {};
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<DebugOverlay />);
    });
    act(() => {
      controls.toggle();
      vi.advanceTimersByTime(100);
    });

    expect(renderer.root.findAllByType("tbody")[0]?.findAllByType("tr")).toHaveLength(0);
    act(() => renderer.unmount());
  });
});
