export const WEBGPU_BROWSER_ARGS = [
  "--ozone-platform=x11",
  "--enable-unsafe-webgpu",
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
] as const;

import type { IPlaytestPointer } from "../scenario.js";

export interface IBrowserPointerChange {
  isPrimary: boolean;
  pointer: Required<IPlaytestPointer>;
  type: "pointerdown" | "pointermove" | "pointerup";
}

export function reconcileBrowserPointers(
  previous: ReadonlyMap<number, Required<IPlaytestPointer>>,
  next: readonly IPlaytestPointer[],
): IBrowserPointerChange[] {
  const normalized = new Map(next.map((pointer) => [pointer.id, {
    buttons: pointer.buttons ?? 1,
    id: pointer.id,
    x: pointer.x,
    y: pointer.y,
  }]));
  const previousPrimary = previous.keys().next().value;
  const nextPrimary = normalized.keys().next().value;
  const changes: IBrowserPointerChange[] = [];
  for (const pointer of previous.values()) {
    if (!normalized.has(pointer.id)) {
      changes.push({ isPrimary: pointer.id === previousPrimary, pointer: { ...pointer, buttons: 0 }, type: "pointerup" });
    }
  }
  for (const pointer of normalized.values()) {
    const old = previous.get(pointer.id);
    if (old === undefined) {
      changes.push({ isPrimary: pointer.id === nextPrimary, pointer, type: "pointerdown" });
    } else if (old.x !== pointer.x || old.y !== pointer.y || old.buttons !== pointer.buttons) {
      changes.push({ isPrimary: pointer.id === nextPrimary, pointer, type: "pointermove" });
    }
  }
  return changes;
}
