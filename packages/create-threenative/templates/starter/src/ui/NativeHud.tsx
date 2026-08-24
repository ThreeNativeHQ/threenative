import { type ICtx, isNative } from "@threenative/core";
import { type IOverlayStyle, Text, View, createReactOverlay } from "@threenative/core/react";
import type { IPhysicsContext } from "@threenative/physics";
import { createElement, useSyncExternalStore } from "react";
import type { GameState } from "../state.js";
import { HudContent, type HudPart, type IHudPrimitiveProps } from "./HudContent.js";

type GameStore = ICtx<GameState, IPhysicsContext>["state"];
type GameCtx = ICtx<GameState, IPhysicsContext>;

const STYLES: Partial<Record<HudPart, IOverlayStyle>> = {
  panel: { direction: "column", gap: 8, left: 24, top: 24 },
  scoreLabel: { color: "#8190a5", fontSize: 10, letterSpacing: 2 },
  score: { color: "#7fffd4", fontSize: 36 },
  lives: { align: "center", direction: "row", gap: 6 },
  meter: { direction: "column", gap: 4 },
  meterHeader: { direction: "row", gap: 12 },
  meterTrack: { background: "#172333", height: 4, width: 96 },
  banner: { centerX: true, direction: "column", gap: 8, top: 180 },
  bannerHint: { color: "#8190a5", fontSize: 12 },
};
const TEXT_PARTS = new Set<HudPart>(["scoreLabel", "score", "bannerTitle", "bannerHint"]);

function NativeHudPrimitive({ active, children, fill, part, won }: IHudPrimitiveProps) {
  if (part === "root") return children;
  const style =
    part === "life"
      ? { background: active === true ? "#7fffd4" : "#172333", height: 8, width: 8 }
      : part === "meterFill"
        ? { background: "#7fffd4", height: 4, width: Math.round((96 * (fill ?? 0)) / 100) }
        : part === "bannerTitle"
          ? { color: won === true ? "#7fffd4" : "#ffffff", fontSize: 48 }
          : STYLES[part];
  const Element = TEXT_PARTS.has(part) ? Text : View;
  return <Element style={style}>{children}</Element>;
}

export function NativeHud({ store }: { store: GameStore }) {
  const state = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getPublishedState(),
    () => store.getPublishedState(),
  );
  return <HudContent Primitive={NativeHudPrimitive} state={state} />;
}

export const nativeUiPlugin = {
  setup(ctx: GameCtx) {
    if (!isNative()) return undefined;
    const overlay = createReactOverlay({ canvasLayer: ctx.canvasLayer });
    overlay.render(createElement(NativeHud, { store: ctx.state }));
    ctx.entities.add("native-ui", {
      debug: () => ({ mounted: true, objectCount: overlay.objectCount }),
    });
    const stop = ctx.every(() => overlay.refresh());
    return () => {
      stop();
      overlay.dispose();
    };
  },
};
