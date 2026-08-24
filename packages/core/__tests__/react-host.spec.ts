import { createElement, useState } from "react";
import type { InstancedMesh, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { CanvasLayer } from "../src/canvas-layer.js";
import { TEXT_ELEMENT, VIEW_ELEMENT, createReactOverlay } from "../src/react-host.js";
import { layoutTree, measureText } from "../src/react-layout.js";
import { Text, View } from "../src/react.js";
import type { IViewportSize } from "../src/viewport.js";

function layer(width = 1080, height = 480): CanvasLayer {
  return new CanvasLayer({
    onResize: () => () => undefined,
    size: { aspect: width / height, height, width } satisfies IViewportSize,
  });
}

function resizableLayer(width = 1080, height = 480) {
  let resize: ((size: IViewportSize) => void) | undefined;
  const canvasLayer = new CanvasLayer({
    onResize: (handler) => {
      resize = handler;
      return () => {
        resize = undefined;
      };
    },
    size: { aspect: width / height, height, width } satisfies IViewportSize,
  });
  return {
    canvasLayer,
    resize(width: number, height: number) {
      resize?.({ aspect: width / height, height, width });
    },
  };
}

describe("createReactOverlay", () => {
  it("is the difference between a CanvasLayer that draws nothing and one that draws the HUD", () => {
    const canvasLayer = layer();

    // Red control, and the bug PRD-216 exists for: a React component that never reaches a renderer
    // leaves the layer empty, which on a phone is a game with no HUD at all.
    expect(canvasLayer.scene.children).toHaveLength(0);

    const overlay = createReactOverlay({ canvasLayer });
    overlay.render(
      createElement(TEXT_ELEMENT, { style: { color: "#ffffff", left: 4, top: 6 } }, "HP 82"),
    );

    const glyphs = canvasLayer.scene.children[0]?.children[0] as InstancedMesh | undefined;
    expect(glyphs?.type).toBe("Mesh");
    expect(glyphs?.count).toBeGreaterThan(0);
    overlay.dispose();
  });

  it("commits a state change in place instead of rebuilding the tree", () => {
    const canvasLayer = layer();
    const overlay = createReactOverlay({ canvasLayer });
    overlay.render(createElement(TEXT_ELEMENT, { style: { color: "#ffffff" } }, "AMMO 30"));
    const first = canvasLayer.scene.children[0]?.children[0];

    overlay.render(createElement(TEXT_ELEMENT, { style: { color: "#ffffff" } }, "AMMO 29"));

    expect(canvasLayer.scene.children[0]?.children[0]).toBe(first);
    overlay.dispose();
  });

  it("re-renders from a hook without the caller touching the tree", () => {
    const canvasLayer = layer();
    const overlay = createReactOverlay({ canvasLayer });
    let bump: (() => void) | undefined;
    function Counter() {
      const [value, setValue] = useState(0);
      bump = () => setValue(value + 1);
      return createElement(TEXT_ELEMENT, { style: { color: "#ffffff" } }, `SCORE ${value}`);
    }
    overlay.render(createElement(Counter));
    const before = (canvasLayer.scene.children[0]?.children[0] as InstancedMesh).count;
    const commitsBefore = overlay.commitCount;

    bump?.();
    overlay.refresh();

    // "SCORE 1" lights a different number of pixels than "SCORE 0"; the point is that it changed
    // without the game re-mounting anything.
    expect((canvasLayer.scene.children[0]?.children[0] as InstancedMesh).count).not.toBe(before);
    expect(overlay.commitCount).toBe(commitsBefore + 1);
    expect(overlay.lastCommitMs).toBeGreaterThanOrEqual(0);
    overlay.refresh();
    expect(overlay.commitCount).toBe(commitsBefore + 1);
    overlay.dispose();
  });

  it("anchors boxes in literal screen pixels from the edge the style names", () => {
    const canvasLayer = layer(1080, 480);
    const overlay = createReactOverlay({ canvasLayer });
    overlay.render(
      createElement(VIEW_ELEMENT, {
        style: { background: "#101418", bottom: 16, height: 40, right: 24, width: 100 },
      }),
    );

    const mesh = canvasLayer.scene.children[0]?.children[0] as Mesh;
    // Group sits on the camera's top-left corner, so a box 24px from the right edge and 16px from
    // the bottom of a 1080x480 surface centres at (1080-24-50, -(480-16-20)).
    expect(mesh.position.x).toBeCloseTo(1006);
    expect(mesh.position.y).toBeCloseTo(-444);
    expect(mesh.scale.x).toBe(100);
    overlay.dispose();
  });

  it("lays a row out left to right with the gap it was given", () => {
    const canvasLayer = layer();
    const overlay = createReactOverlay({ canvasLayer });
    overlay.render(
      createElement(
        VIEW_ELEMENT,
        { style: { direction: "row", gap: 10, left: 0, top: 0 } },
        createElement(VIEW_ELEMENT, {
          key: "a",
          style: { background: "#ff0000", height: 8, width: 20 },
        }),
        createElement(VIEW_ELEMENT, {
          key: "b",
          style: { background: "#00ff00", height: 8, width: 30 },
        }),
      ),
    );

    // The wrapping <view> has no background, so it draws nothing: the group holds the two children.
    const [first, second] = canvasLayer.scene.children[0]?.children as Mesh[];
    expect(first?.position.x).toBeCloseTo(10);
    expect(second?.position.x).toBeCloseTo(45);
    overlay.dispose();
  });

  it("paints a container background before its children even when the container has zIndex", () => {
    const canvasLayer = layer();
    const overlay = createReactOverlay({ canvasLayer });
    overlay.render(
      createElement(
        VIEW_ELEMENT,
        { style: { background: "#101418", height: 40, width: 120, zIndex: 1 } },
        createElement(TEXT_ELEMENT, { style: { color: "#ffffff" } }, "HP 82"),
      ),
    );

    const [plate, glyphs] = canvasLayer.scene.children[0]?.children as [Mesh, InstancedMesh];
    expect(glyphs.renderOrder).toBeGreaterThan(plate.renderOrder);
    overlay.dispose();
  });

  it("relayouts an anchored HUD immediately when the CanvasLayer resizes", () => {
    const fixture = resizableLayer(1080, 480);
    const overlay = createReactOverlay({ canvasLayer: fixture.canvasLayer });
    overlay.render(
      createElement(VIEW_ELEMENT, {
        style: { background: "#101418", height: 40, right: 24, top: 8, width: 100 },
      }),
    );
    const plate = fixture.canvasLayer.scene.children[0]?.children[0] as Mesh;
    expect(plate.position.x).toBeCloseTo(1006);

    fixture.resize(1920, 1080);

    expect(plate.position.x).toBeCloseTo(1846);
    overlay.dispose();
  });

  it("recovers after a transient unsupported glyph leaves the tree", () => {
    const canvasLayer = layer();
    const errors: string[] = [];
    const overlay = createReactOverlay({
      canvasLayer,
      onError: (error) => errors.push(error.message),
    });
    let setLabel: ((label: string) => void) | undefined;
    function DynamicLabel() {
      const [label, updateLabel] = useState("HP 2");
      setLabel = updateLabel;
      return createElement(TEXT_ELEMENT, { style: { color: "#ffffff" } }, label);
    }
    overlay.render(createElement(DynamicLabel));

    setLabel?.("HP ×2");
    overlay.refresh();
    expect(errors.at(-1)).toContain("TN_REACT_UNKNOWN_GLYPH");

    setLabel?.("HP 3");
    overlay.refresh();

    const visible = canvasLayer.scene.children[0]?.children.find((child) => child.visible) as
      | InstancedMesh
      | undefined;
    expect((visible?.material as MeshBasicMaterial | undefined)?.color.getHexString()).toBe(
      "ffffff",
    );
    overlay.dispose();
  });

  it("provides the non-null host context React 19 requires", () => {
    const hostContextWarning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const overlay = createReactOverlay({ canvasLayer: layer() });

    overlay.render(createElement(TEXT_ELEMENT, null, "READY"));

    expect(hostContextWarning).not.toHaveBeenCalledWith(
      expect.stringContaining("Expected host context to exist"),
    );
    overlay.dispose();
    hostContextWarning.mockRestore();
  });

  it("fails by name on a DOM tag, and says so on screen rather than going blank", () => {
    const canvasLayer = layer();
    const errors: string[] = [];
    const overlay = createReactOverlay({ canvasLayer, onError: (e) => errors.push(e.message) });

    overlay.render(createElement("div", null, "this cannot cross"));

    expect(errors.join("\n")).toContain("TN_REACT_UNKNOWN_ELEMENT: <div>");
    // The negative control from the PRD: a broken component must not look like an absent one.
    const banner = canvasLayer.scene.children[0]?.children[0] as InstancedMesh | undefined;
    expect(banner?.count ?? 0).toBeGreaterThan(0);
    overlay.dispose();
  });

  it("refuses a style key it does not implement instead of dropping it", () => {
    const canvasLayer = layer();
    const errors: string[] = [];
    const overlay = createReactOverlay({ canvasLayer, onError: (e) => errors.push(e.message) });

    overlay.render(createElement(VIEW_ELEMENT, { style: { flexWrap: "wrap" } }));

    expect(errors.join("\n")).toContain("TN_REACT_UNKNOWN_STYLE");
    expect(errors.join("\n")).toContain("flexWrap");
    overlay.dispose();
  });

  it("draws the exported View and Text components, which is what a game writes", () => {
    const canvasLayer = layer();
    const errors: string[] = [];
    const overlay = createReactOverlay({ canvasLayer, onError: (e) => errors.push(e.message) });

    overlay.render(
      createElement(
        View,
        { style: { background: "#101418", height: 30, left: 8, top: 8, width: 120 } },
        createElement(Text, { style: { color: "#ffa63d", fontSize: 16 } }, "HP 100"),
      ),
    );

    expect(errors).toEqual([]);
    const [plate, glyphs] = canvasLayer.scene.children[0]?.children as [Mesh, InstancedMesh];
    expect(plate.scale.x).toBe(120);
    expect(glyphs.count).toBeGreaterThan(0);
    overlay.dispose();
  });

  it("releases everything it made when the overlay goes away", () => {
    const canvasLayer = layer();
    const overlay = createReactOverlay({ canvasLayer });
    overlay.render(createElement(TEXT_ELEMENT, { style: { color: "#ffffff" } }, "BYE"));
    expect(canvasLayer.scene.children).toHaveLength(1);

    overlay.dispose();

    expect(canvasLayer.scene.children).toHaveLength(0);
  });
});

describe("the layout subset", () => {
  it("measures a glyph run against the 5x7 grid, not a font metric", () => {
    // Three characters at a 14px cell: two full advances of 12px plus the final 10px-wide glyph.
    expect(measureText("ABC", 14)).toBeCloseTo(34);
    expect(measureText("", 14)).toBe(0);
  });

  it("refuses a zero-sized surface rather than reporting an empty HUD as success", () => {
    const root = {
      kind: "view" as const,
      style: {},
      text: "",
      children: [],
      box: { x: 0, y: 0, width: 0, height: 0 },
      resolvedFontSize: 14,
    };
    expect(() => layoutTree(root, 0, 480)).toThrow("TN_REACT_LAYOUT_EMPTY_VIEWPORT");
  });
});
