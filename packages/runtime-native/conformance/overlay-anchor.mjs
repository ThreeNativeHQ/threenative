/**
 * The camera-parented overlay row proves a HUD anchored in pixel space stays anchored when the
 * viewport changes. The previous version only recomputed a projection matrix, so it passed
 * without the renderer or the canvas ever changing size — a synthetic proof.
 *
 * These helpers are the fail-closed half of that row, kept pure so a node test can drive them
 * without a GPU. `assertRenderedSize` reads the real drawing-buffer dimensions, so deleting the
 * `renderer.setSize` call makes the row throw instead of quietly passing.
 */

export const OVERLAY_ANCHOR = Object.freeze({ height: 28, width: 96, x: 48, y: 32 });

export const OVERLAY_VIEWPORTS = Object.freeze([
  Object.freeze({ height: 720, width: 1280 }),
  Object.freeze({ height: 768, width: 1024 }),
  Object.freeze({ height: 1280, width: 720 }),
  Object.freeze({ height: 1280, width: 800 }),
]);

/** Every size the row renders at, ending on the capture size the comparison expects. */
export function overlayRenderPlan(dimensions) {
  return [...OVERLAY_VIEWPORTS, { height: dimensions.height, width: dimensions.width }];
}

/**
 * `observed` must come from the drawing buffer (`canvas.width`/`canvas.height`), never from the
 * requested numbers — reading back what we asked for would prove nothing.
 */
export function assertRenderedSize(requested, observed) {
  if (
    !observed ||
    observed.width !== requested.width ||
    observed.height !== requested.height
  ) {
    throw new Error(
      `TN_CONFORMANCE_RESIZE_NOT_APPLIED: requested ${requested.width}x${requested.height}, ` +
        `the drawing buffer reports ${observed?.width}x${observed?.height}.`,
    );
  }
  return observed;
}

export function assertAnchorHeld(size, actual, tolerance = 1.5) {
  const expected = {
    x: OVERLAY_ANCHOR.x + OVERLAY_ANCHOR.width / 2,
    y: OVERLAY_ANCHOR.y + OVERLAY_ANCHOR.height / 2,
  };
  if (
    !Number.isFinite(actual?.x) ||
    !Number.isFinite(actual?.y) ||
    Math.abs(actual.x - expected.x) >= tolerance ||
    Math.abs(actual.y - expected.y) >= tolerance
  ) {
    throw new Error(
      `TN_CONFORMANCE_OVERLAY_ANCHOR_DRIFTED: at ${size.width}x${size.height} the overlay ` +
        `centre projected to ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
    );
  }
  return actual;
}
