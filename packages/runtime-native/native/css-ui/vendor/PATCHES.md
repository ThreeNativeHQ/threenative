# Vendored patches

Three upstream crates are vendored here and wired with `[patch.crates-io]` in this crate's
`Cargo.toml`. Each is a pinned version copied from the crates.io registry source unchanged apart
from the hunks below; `LICENSE-MIT` / `LICENSE-APACHE` are the upstream licences, which the
published `.crate` archives omit.

Every hunk is here because the browser oracle in `examples/native-css-hud/corpus` proves the
behaviour it fixes, and each names the fixture that proves it. They are deliberately kept to
single-property fixes so that dropping a patch is a one-line change in `Cargo.toml`.

Run `cd examples/native-css-hud && node corpus/oracle.mjs` for the measurements quoted below.

## `blitz-paint-0.3.0-beta.2` — 27 added code lines

### 1. `outline-offset` was ignored: the outline was drawn inside the border box

* **Where:** `src/kurbo_css/css_box.rs` (`CssBox::new`, `CssBox::outline`, `CssBox::corner`,
  `CssBox::is_sharp`, `CssBox::ellipse`), `src/kurbo_css/mod.rs` (a new
  `CssBoxKind::OutlineInnerBox`), `src/render.rs` (`create_css_rect` reads
  `style.get_outline().outline_offset`).
* **Why:** the outline ring ran from `border_box.inset(outline_width)` (kurbo's `inset` grows for a
  positive amount) to the border box, so `outline-offset: 3px` left the ring touching the box. CSS
  UI 4 §4.2 puts the ring `outline-offset` away from the border edge and `outline-width` thick
  outwards from there. The inner edge is a new box kind because the ring can no longer start at the
  border box, and its corner radii grow by the offset.
* **Proves it:** `paint-radius-border-shadow` — the white outline now sits 3px off the blue box
  (SSIM 0.9425 → 0.9996, fixture passes). `outline-offset` 0, 3 and 6 on a bare 100×60 box are each
  pixel-identical to Chromium.

## `blitz-dom-0.3.0-beta.2` — 70 added code lines

### 1. hoisted (`z-index`) children were painted one frame late, at the wrong offset

* **Where:** `src/layout/damage.rs` (`flush_styles_to_layout_impl`, plus the new
  `resolve_hoisted_paint_positions{,_impl}`), `src/resolve.rs` (one call after `resolve_layout`).
* **Why:** `flush_styles_to_layout` runs *before* layout and folded each node's
  `final_layout().location` into the hoisted children's paint offsets while the tree was being
  built. Those locations are the previous frame's, and all zero on the first frame, so a
  `position: absolute; z-index: 1` box was painted at its containing block's origin instead of
  where it laid out — the cyan square in `positioning` was 10px (the margined parent's offset) off.
  The same staleness fed `HoistedPaintChildren::content_area`, which hit testing reads, so that is
  recomputed here too.
* **Proves it:** `positioning` — SSIM 0.9603 → 1.0, fixture passes. Every box in it already matched
  within 1px, which is what made this a paint-only bug.

### 2. a non-atomic inline's box was its line box instead of its font box

* **Where:** `src/document.rs` (`inline_fragment_rects`).
* **Why:** the fragment rect of an inline element used the line box's block extent (the
  leading-included extent text selection highlights use), so `getClientRects()` reported every
  inline as tall as its line. Browsers report the font box: the run's ascent and descent either
  side of the line's baseline.
* **Proves it:** `ua-defaults` — five inline elements (`a`, `strong`, `em`, `b`, `i`) go from
  1.06px tall on the bottom edge to within 1px, and the fixture passes.

### 3. an atomic inline had no baseline of its own

* **Where:** `src/layout/inline.rs` (the inline-box sizing loop), `src/layout/construct.rs` (two
  `InlineBox` literals).
* **Why:** `parley::InlineBox` had no baseline, so parley aligned every atomic inline by its bottom
  margin edge. That is only right for a box with no in-flow line boxes (CSS 2.1 §10.8.1); an
  `inline-block` or `inline-flex` with text aligns on its content's baseline. Without this, patch 1
  below makes every line holding a button 6px too tall — visible as a regression in this crate's own
  Chrome-derived reference frame. The sizing loop therefore asks for a *perform-layout* pass (the
  child's baseline is not reported by a measure-only pass) and stores it, measured from the margin
  box top like the box's height.
* **Proves it:** `cargo test --release` (34 tests, including `matches_the_chrome_reference_frame`,
  which compares against a frame Chrome produced) plus the `positioning` and `box-model-and-sizing`
  fixtures.

## `parley-0.11.1` — 115 added code lines

This is the one patch over the ~80-line guideline, and the overage is honest: ~25 of the lines are
the shared `leading_box` helper, which replaced two copies of the same half-leading arithmetic. Only
hunk 1 is separable — dropping it reverts `box-model-and-sizing` and changes nothing else.

### 1. line boxes had no strut and distributed half-leading once per line

* **Where:** `src/layout/line_break.rs` (`finish_line`, `start_new_line`),
  `src/layout/data.rs` (`LayoutData::strut_ascent`/`strut_descent`), `src/layout/line.rs` (the new
  `leading_box`, and `InlineBox` placement in `line.rs`'s item iterator), `src/inline_box.rs` (the
  new `InlineBox::baseline`), `src/builder.rs` (`strut_metrics`, called from `build_into_layout`),
  `src/resolve/tree.rs` (`begin` now puts the root style at style-table index 0).
* **Why:** parley computed a line's height as the largest `line-height` on it and then split the
  remaining leading once for the whole line. CSS 2.1 §10.8.1 is per inline box: each one's
  half-leading sits around *its* baseline, and every line also carries a strut built from the block
  container's own font and line-height. So a line holding only atomic inlines lost the strut's
  descent (a 100×60 line of two `inline-block`s came out 36px instead of 42px), and a line mixing a
  16px and a 12px run came out 24px instead of 25.35px. `strut_metrics` measures the strut through
  the same font query the shaper uses, so it is the same face at the same scale; with no resolvable
  font it is `(0, 0)` and line boxes stay as tall as their content. The root style is now always
  style-table entry 0, because a layout with no text never commits a span and the strut is measured
  before line breaking.
* **Proves it:** `box-model-and-sizing` — the `div` holding two inline-blocks is 42px, matching
  Chromium (fixture passes, SSIM 1.0), and `inline-runs`' paragraph is 50px (was 48px).
