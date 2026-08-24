import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH } from "./react-glyphs.js";

/**
 * The layout model behind the native React overlay: pure TypeScript, no WASM, no Yoga, no CSS
 * parser. `TN_NATIVE_WASM_ON_MOBILE` refuses WebAssembly in mobile bundles, which rules out Yoga;
 * a CSS engine is a browser, which is the thing this whole path exists to avoid.
 *
 * **The supported subset is exactly the fields on {@link IOverlayStyle} and nothing else.** A style
 * key that is not on that interface is not "ignored for now" — {@link assertKnownStyle} throws
 * `TN_REACT_UNKNOWN_STYLE` naming the key, because a convention discovered by failure is worse than
 * one that does not exist.
 *
 * Units are screen pixels throughout, matching `CanvasLayer`'s orthographic camera. The origin is
 * the top-left of the parent's content box, y increasing downwards, like a screen and unlike Three.
 */

/** `#rrggbb`, `#rgb`, or a packed `0xrrggbb` number. Alpha is `opacity`, kept separate on purpose. */
export type OverlayColor = string | number;

export interface IOverlayStyle {
  /** Distance from the parent's left content edge. Ignored when the parent lays out in flow. */
  left?: number;
  /** Distance from the parent's right content edge. Applied only when `left` is absent. */
  right?: number;
  /** Distance from the parent's top content edge. Ignored when the parent lays out in flow. */
  top?: number;
  /** Distance from the parent's bottom content edge. Applied only when `top` is absent. */
  bottom?: number;
  /** Centre horizontally in the parent's content box. Wins over `left`/`right`. */
  centerX?: boolean;
  /** Centre vertically in the parent's content box. Wins over `top`/`bottom`. */
  centerY?: boolean;
  /** Fixed width. Without one, a box shrink-wraps its children and text measures its glyphs. */
  width?: number;
  /** Fixed height. Without one, a box shrink-wraps its children and text is one line tall. */
  height?: number;
  /** Uniform inset between this box's edges and its content box. */
  padding?: number;
  /** Lay children out in flow along this axis. Absent means children are placed absolutely. */
  direction?: "row" | "column";
  /** Space between flow children, in pixels. Only meaningful with `direction`. */
  gap?: number;
  /** Cross-axis placement of flow children. */
  align?: "start" | "center" | "end";
  /** Fill colour. Absent means the box draws nothing and only positions its children. */
  background?: OverlayColor;
  /** Glyph colour on a `text` element. */
  color?: OverlayColor;
  /** 0-1, multiplied into whatever this element draws. Children carry their own. */
  opacity?: number;
  /** Cell height of one glyph in pixels; the 5x7 grid scales to it. Inherited by descendants. */
  fontSize?: number;
  /** Extra pixels between glyph cells, on top of the 5x7 grid's one-column gap. */
  letterSpacing?: number;
  /** Horizontal placement of the glyph run inside a `text` box that has a `width`. */
  textAlign?: "left" | "center" | "right";
  /** Paint order among siblings. Higher paints later. Ties fall back to tree order. */
  zIndex?: number;
}

const STYLE_KEYS: ReadonlySet<string> = new Set<keyof IOverlayStyle>([
  "left",
  "right",
  "top",
  "bottom",
  "centerX",
  "centerY",
  "width",
  "height",
  "padding",
  "direction",
  "gap",
  "align",
  "background",
  "color",
  "opacity",
  "fontSize",
  "letterSpacing",
  "textAlign",
  "zIndex",
]);

/** Fail closed on an unsupported style key, naming it. Silently dropping it is how a HUD lies. */
export function assertKnownStyle(style: IOverlayStyle, elementType: string): void {
  for (const key of Object.keys(style)) {
    if (STYLE_KEYS.has(key)) continue;
    throw new Error(
      `TN_REACT_UNKNOWN_STYLE: <${elementType}> was given style '${key}', which the native overlay does not implement. Supported: ${[...STYLE_KEYS].join(", ")}.`,
    );
  }
}

/**
 * Every style key the overlay implements, for the templates' AGENTS.md and for error messages.
 * @situation discover which React HUD style properties work on native
 * @example supportedStyleKeys().includes("centerX")
 */
export function supportedStyleKeys(): readonly string[] {
  return [...STYLE_KEYS];
}

/** A resolved rectangle in screen pixels, origin top-left of the framebuffer. */
export interface IOverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the layout pass walks. The host config builds these; nothing else should. */
export interface ILayoutNode {
  readonly kind: "view" | "text";
  style: IOverlayStyle;
  text: string;
  children: ILayoutNode[];
  /** Filled by {@link layoutTree}. */
  box: IOverlayBox;
  /** Font size actually used, after inheritance. Filled by {@link layoutTree}. */
  resolvedFontSize: number;
}

/** Default cell height when no ancestor sets one. Small enough to be legible on a 1080p phone. */
const DEFAULT_FONT_SIZE = 14;

/**
 * Width in pixels of a glyph run at a given cell height.
 * @situation measure native React HUD text before laying it out
 * @example const scoreWidth = measureText("SCORE 10", 24)
 */
export function measureText(text: string, fontSize: number, letterSpacing = 0): number {
  if (text.length === 0) return 0;
  const cell = fontSize / GLYPH_HEIGHT;
  const advance = GLYPH_ADVANCE * cell + letterSpacing;
  return (text.length - 1) * advance + GLYPH_WIDTH * cell;
}

function intrinsicSize(node: ILayoutNode, fontSize: number): { width: number; height: number } {
  const { style } = node;
  if (node.kind === "text") {
    return {
      width: style.width ?? measureText(node.text, fontSize, style.letterSpacing ?? 0),
      height: style.height ?? fontSize,
    };
  }
  const padding = style.padding ?? 0;
  const gap = style.gap ?? 0;
  let contentWidth = 0;
  let contentHeight = 0;
  for (const [index, child] of node.children.entries()) {
    const childFont = child.style.fontSize ?? fontSize;
    const size = intrinsicSize(child, childFont);
    if (style.direction === "row") {
      contentWidth += size.width + (index > 0 ? gap : 0);
      contentHeight = Math.max(contentHeight, size.height);
    } else if (style.direction === "column") {
      contentHeight += size.height + (index > 0 ? gap : 0);
      contentWidth = Math.max(contentWidth, size.width);
    } else {
      // Absolute children: the box wraps whatever reaches furthest from its top-left.
      contentWidth = Math.max(contentWidth, (child.style.left ?? 0) + size.width);
      contentHeight = Math.max(contentHeight, (child.style.top ?? 0) + size.height);
    }
  }
  return {
    width: style.width ?? contentWidth + padding * 2,
    height: style.height ?? contentHeight + padding * 2,
  };
}

function crossOffset(align: IOverlayStyle["align"], available: number, size: number): number {
  if (align === "center") return (available - size) / 2;
  if (align === "end") return available - size;
  return 0;
}

function place(node: ILayoutNode, content: IOverlayBox, size: { width: number; height: number }) {
  const { style } = node;
  let x: number;
  if (style.centerX === true) x = content.x + (content.width - size.width) / 2;
  else if (style.left !== undefined) x = content.x + style.left;
  else if (style.right !== undefined) x = content.x + content.width - style.right - size.width;
  else x = content.x;
  let y: number;
  if (style.centerY === true) y = content.y + (content.height - size.height) / 2;
  else if (style.top !== undefined) y = content.y + style.top;
  else if (style.bottom !== undefined) y = content.y + content.height - style.bottom - size.height;
  else y = content.y;
  node.box = { x, y, width: size.width, height: size.height };
}

/**
 * Resolve every box in the tree against a root of `width` x `height` screen pixels.
 *
 * Two passes, both cheap and both non-recursive in cost terms: measure intrinsic sizes bottom-up,
 * then assign positions top-down. It refuses nothing silently — a zero-sized root is a caller bug
 * and throws, matching the framework's fail-closed rule.
 */
export function layoutTree(root: ILayoutNode, width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(
      `TN_REACT_LAYOUT_EMPTY_VIEWPORT: the overlay was laid out against ${width}x${height}. A zero-sized surface draws nothing and would look identical to a crash.`,
    );
  }
  root.box = { x: 0, y: 0, width, height };
  root.resolvedFontSize = root.style.fontSize ?? DEFAULT_FONT_SIZE;
  arrange(root, root.resolvedFontSize);
}

function arrange(node: ILayoutNode, fontSize: number): void {
  const { style } = node;
  const padding = style.padding ?? 0;
  const content: IOverlayBox = {
    x: node.box.x + padding,
    y: node.box.y + padding,
    width: Math.max(0, node.box.width - padding * 2),
    height: Math.max(0, node.box.height - padding * 2),
  };
  const gap = style.gap ?? 0;
  let cursor = style.direction === "row" ? content.x : content.y;
  for (const [index, child] of node.children.entries()) {
    const childFont = child.style.fontSize ?? fontSize;
    child.resolvedFontSize = childFont;
    const size = intrinsicSize(child, childFont);
    if (style.direction === "row") {
      if (index > 0) cursor += gap;
      child.box = {
        x: cursor,
        y: content.y + crossOffset(style.align, content.height, size.height),
        width: size.width,
        height: size.height,
      };
      cursor += size.width;
    } else if (style.direction === "column") {
      if (index > 0) cursor += gap;
      child.box = {
        x: content.x + crossOffset(style.align, content.width, size.width),
        y: cursor,
        width: size.width,
        height: size.height,
      };
      cursor += size.height;
    } else {
      place(child, content, size);
    }
    arrange(child, childFont);
  }
}

/** The x offset of a glyph run inside its own box, honouring `textAlign`. */
export function textOffset(node: ILayoutNode): number {
  const runWidth = measureText(node.text, node.resolvedFontSize, node.style.letterSpacing ?? 0);
  if (node.style.textAlign === "center") return (node.box.width - runWidth) / 2;
  if (node.style.textAlign === "right") return node.box.width - runWidth;
  return 0;
}

export { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPH_ADVANCE };
