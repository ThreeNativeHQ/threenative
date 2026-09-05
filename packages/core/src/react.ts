import { type ReactNode, createElement } from "react";
import { TEXT_ELEMENT, VIEW_ELEMENT } from "./react-host.js";
import type { IOverlayStyle } from "./react-layout.js";

/**
 * `@threenative/core/react` — React that renders on a phone, with no DOM and no WebView.
 *
 * A subpath on purpose. `react` and `react-reconciler` are **optional** peers, and nothing in
 * `@threenative/core`'s main entry imports either of them, so a game that never mounts a React
 * overlay pays nothing and core stays consumable from React Three Fiber. Importing this module is
 * the opt-in.
 *
 * The element vocabulary is two components, borrowed from React Native rather than invented:
 * {@link View} is a rectangle, {@link Text} is a run of glyphs. They are components and not
 * lowercase intrinsics because `view` and `text` are already SVG tags in `@types/react`, and a
 * HUD element that silently means `<svg:text>` on one platform is exactly the kind of quiet
 * divergence this path exists to end.
 *
 * @situation render a React HUD on Android or iOS without a WebView
 * @situation show the same React component on web and on a phone
 * @constraint styling is the `style` prop; Tailwind class names are CSS and cannot cross
 * @constraint import `react`, never `react-dom`, from the portable native entry
 * @example const overlay = createReactOverlay({ canvasLayer: ctx.canvasLayer });
 */

export { createReactOverlay, TEXT_ELEMENT, VIEW_ELEMENT } from "./react-host.js";
export type { IReactOverlay, IReactOverlayOptions } from "./react-host.js";
export type { IOverlayBox, IOverlayStyle, OverlayColor } from "./react-layout.js";
export { measureText, supportedStyleKeys } from "./react-layout.js";
export { supportedGlyphs } from "./react-glyphs.js";

export interface IViewProps {
  style?: IOverlayStyle;
  children?: ReactNode;
}

export interface ITextProps {
  style?: IOverlayStyle;
  /** Strings and numbers only. Nesting an element inside `Text` has nothing to draw it with. */
  children?: ReactNode;
}

/**
 * A rectangle. Paints when its style has a `background`; otherwise it only positions children.
 * @situation group and position native React HUD elements
 * @example <View style={{ centerX: true, top: 24 }}><Text>READY</Text></View>
 */
export function View(props: IViewProps): ReactNode {
  return createElement(VIEW_ELEMENT, { style: props.style }, props.children);
}

/**
 * A run of bitmap glyphs, drawn as one instanced quad per lit pixel.
 * @situation show text in a native React HUD without a DOM
 * @alias objective panel journal
 * @example <Text style={{ color: "#ffffff", fontSize: 24 }}>SCORE 10</Text>
 */
export function Text(props: ITextProps): ReactNode {
  return createElement(TEXT_ELEMENT, { style: props.style }, props.children);
}
