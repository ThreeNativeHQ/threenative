# Vendored patches

Three upstream crates are vendored here and wired with `[patch.crates-io]` in this crate's
`Cargo.toml`. Each is a pinned version copied from the crates.io registry source unchanged apart
from the hunks below; `LICENSE-MIT` / `LICENSE-APACHE` are the upstream licences, which the
published `.crate` archives omit.

Every hunk is here because a measurement proves the behaviour it fixes — almost always a fixture in
the browser oracle in `examples/native-css-hud/corpus`, which each hunk names — and each is kept to
a single property so that dropping a patch is a one-line change in `Cargo.toml`. The exception is
the one the browser cannot see, blitz-dom hunk 4, a retained record that only shows up in
`bench mount`'s resident set and in the crate's own release build.

Run `cd examples/native-css-hud && node corpus/oracle.mjs` for the measurements quoted below, and
`node corpus/interaction.mjs` for the interaction scenarios (hunks 8-12), which is the oracle an
interaction hunk is proved against.

Two hunks are over the ~80-line guideline: parley hunk 1 below, and blitz-dom hunk 11. Hunk 11 is
the hit-test clip, and the overage is the rounded-rectangle test (~20 of those lines): a
`border-radius` may round a corner to an ellipse, so one point needs both radii to be answered, and
answering it in the shared walk is what keeps a click in a clipped-away corner from being one hit
per ancestor. The separable part is the `clip` argument on `hit_inner`; dropping it leaves the
radius half working for the element's own box only.

## `blitz-paint-0.3.0-beta.2` — 31 added code lines

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

### 2. an inline layout's cut line was not the line that got painted

* **Where:** `src/render.rs` (`draw_inline_layout`: one `painted` binding, and the three text passes
  that read it).
* **Why:** `text-overflow: ellipsis` is laid out as its own inline layout alongside the whole line
  (blitz-dom hunk 7), and paint drew the whole line — the ellipsis was laid out and thrown away.
  Nothing else in this crate reads it: the element's box, hit testing and selection all still use
  the uncut line, which is what keeps a resize honest.
* **Proves it:** `text-ellipsis` — SSIM 0.9603 → 0.9947, fixture passes on the strict 0.99 bar.

## `blitz-dom-0.3.0-beta.2` — 328 added code lines

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

### 4. every node ever created was recorded, and freed

* **Where:** `src/document.rs` (`remove_node_from_tree`, plus the new `BaseDocument::node_count`).
* **Why:** `create_node` records each new node in `changed_nodes` for the accessibility tree, and
  nothing ever drained that record: the only reader is `has_changes()`, which no caller has and
  whose sense is inverted. So the set grew by one entry per node the document had ever built, for
  as long as it lived. A HUD mounts and disposes panels, so this is the normal path, not an edge
  one: `bench mount` reported 58 → 77 → 114 MB of resident set over 3,200 build-then-remove cycles
  of a 1,000-element HUD, and a `HashSet<NodeId>` of 6.08M entries accounts for the climb. The set
  describes the nodes that changed *and are still live*, so freeing the node frees its record, and
  `remove_node_from_tree` is the one place every removal (a dropped subtree, a deallocated anonymous
  block) funnels through.
* **Proves it:** `cargo test --release` —
  `mounting_and_disposing_repeatedly_releases_every_node` runs 600 mount/dispose cycles and fails
  on the released heap (4.7 MB retained, against a 256 KB budget for a neighbouring test's frame
  buffer). `bench mount` over 3,200 cycles of a 1,000-element HUD now reports 33 → 36 → 33 → 33 MB
  at the quarters where it used to report 58 → 77 → 114 → 114, and `bench resheet` 30 → 37 → 30 →
  30 MB against 58 → 77 → 114 → 114: flat inside allocator noise, where it climbed before.

### 5. `<button>`'s user-agent sheet claimed a centring Chromium does not do

* **Where:** `assets/default.css` (the `button` / `input[type=…]` rule).
* **Why:** the sheet is Gecko's, and Gecko emulates the button box with `display: inline-flex;
  align-items: center; justify-content: center`. Chromium's own sheet is `display: inline-block;
  text-align: center; align-items: flex-start` — it centres the content in its *own* box rather than
  as a flex item. The two agree for a button with no author `display`, and disagree for an author
  `display: flex`: with Gecko's values the label is centred, with Chromium's it is flush to the
  content box's top-start, which is what a fixed-height `display: flex` button looks like there.
* **Proves it:** `button-centring` — the author-`display: flex` button's label lands where
  Chromium's does, and the inline-block button's is centred (SSIM 0.9968, fixture passes). Dropping
  the alignment hunk below puts that label 5px high and the fixture at 0.9769.

### 6. a `<button>`'s content was top-aligned in its content box

* **Where:** `src/layout/inline.rs` (the new centre-the-content step after the line boxes are
  aligned, and its `shift_lines` call), with `Layout::shift_lines` in the parley hunk below.
* **Why:** a button's box is not its content box — Blink's `LayoutNGButton` and Gecko's
  `-moz-button-content` both centre the content in it — so a fixed-height button's label sat
  ~5px high in every fixed-height button this crate laid out. Only a flow-rooted inside display is
  that button box: `display: flex`/`grid` is the author's own layout, where the user-agent sheet's
  `align-items` governs instead (hunk 5), so the two halves are kept apart. The content's own
  height is the only height known where this can be applied, so what it centres is the line boxes:
  a button whose content is a block box stays top-aligned, which is the one case this hunk does not
  cover and no fixture measures.
* **Proves it:** `state-selectors-and-environment` — its three `display: block` buttons' labels move
  from 5px high to centred (SSIM 0.9650 → 0.9952, fixture passes), and `button-centring` covers
  `inline-block` and `flex` in the same frame. `cargo test --release` (35 tests, including
  `matches_the_chrome_reference_frame`) plus every other fixture stay green.

### 7. `text-overflow: ellipsis` painted nothing

* **Where:** `src/layout/inline.rs` (the new `ellipsize_inline_layout`, called once the line boxes
  are aligned), `src/node/text.rs` (`TextLayout::ellipsized`), with the paint half in blitz-paint
  below.
* **Why:** neither Stylo nor parley nor blitz implements `text-overflow`, so an overflowing
  `white-space: nowrap` line was simply clipped at the content box, and Chromium's U+2026 was
  missing from the frame. Cutting the line is not something a shaped layout can do: a `nowrap` line
  is never broken, so narrowing the break advance moves nothing, and parley cannot drop trailing
  clusters. So the prefix that still fits — the last whole cluster whose advance, plus the
  ellipsis's own, stays inside the content box — is re-shaped with a U+2026 appended and kept as
  `TextLayout::ellipsized`. It is a second layout rather than a replacement on purpose: `layout`
  still holds every cluster of the line, so the element's own box is measured from the uncut text
  and a wider content box breaks the whole line again instead of staying stuck short. Only the
  single-line case is modelled (`text-overflow: <string>` and a multi-line ellipsis are not), the
  cut is by logical cluster so a right-to-left line is cut at its start, and the ellipsis takes the
  inline root's font rather than the run's.
* **Proves it:** `text-ellipsis` — SSIM 0.9603 → 0.9947, fixture passes on the strict 0.99 bar, and
  `text-overflow-fits` proves the other half, that a line which fits comes out exactly as it would
  with no `text-overflow` at all (forcing the ellipsis on a fitting line drops it to 0.9786).

### 8. `:focus-visible` never matched, and a pointer focus could not be told from a keyboard one

* **Where:** `src/stylo.rs` (`NonTSPseudoClass::FocusVisible`), `src/document.rs` (the new
  `set_focus_visible`, with `set_focus_to` delegating to it), `src/node/node.rs` (`Node::focus`
  takes the focus-visible flag).
* **Why:** `:focus-visible` was hard-coded to `false`, so a control focused by Tab looked the
  same as one never focused — a keyboard HUD gave no feedback at all. Matching it needs a state bit
  to read, and `ElementState::FOCUSRING` was already set on *every* focus, so there was no way to
  keep a pointer focus (a click on a button) from raising the ring. `focus_visible` is the flag
  that separates them, and it is a per-call argument rather than a document setting because the
  caller is the only one that knows which kind of focus caused the change.
* **Proves it:** `focus-traversal-and-activation` — the pixel after two Tabs is `#f59e0b`, the
  `:focus-visible` colour, and the pixel after a mouse click on the same button is its own
  `#334155`; `tests/interaction.rs::a_pointer_focus_is_not_a_focus_visible_one`. Reverting the
  `stylo.rs` line alone fails the scenario and the test.

### 9. the device could not say it was driven by touch

* **Where:** `src/document.rs` (`make_device` takes a `touch` flag, the new `set_touch`, and the
  `touch` field), `src/mutator.rs` (one argument at the `ViewportMut` drop).
* **Why:** `make_device` passed `PointerCapabilities::default()`, which is a mouse with hover on
  every non-mobile target, so `@media (hover: hover)` and `(pointer: coarse)` could not be
  answered at all. A touch-only device is `(hover: none) (pointer: coarse)`, which is what makes
  Tailwind's `@media (hover:hover){.hover\:bg-…:hover{…}}` — the wrapper Tailwind puts around
  every `hover:` class — not apply on a phone. The flag is a plain `bool` rather than the stylo
  `PointerCapabilities` bitflags so that no caller has to name a stylo type to reach it.
* **Proves it:** `touch-hover-and-environment` (a tap leaves `.h` its own colour under
  `(hover:hover)`, and `tests/interaction.rs::a_mouse_hovers_and_a_finger_does_not`), plus
  `a_tap_leaves_no_hover_behind`.

### 10. a wheel delta that a scroller could not fully take was handed to its parent

* **Where:** `src/scrolling.rs` (the new `scroll_wheel`).
* **Why:** `scroll_chain_by` transfers whatever the first scroller could not consume to its parent
  within the same event, which is right for a fling and wrong for a wheel tick: a browser latches
  the tick to one scroller. Over a list that could take 90px of a 300px tick, the browser scrolled
  the list by 90 and stopped, while this scrolled the list by 90 and the page by 210. It also
  walked the whole ancestor chain for a *programmatic* scroll, which is not a user scroll at all.
  `scroll_wheel` takes the nearest scroller that can move in the requested direction — one with
  room left takes the whole delta and keeps the rest, one at its limit passes the event on — and
  never reaches the viewport, because this document has no page to scroll.
* **Proves it:** `nested-scroll` — three wheels of 50, 300 and 300px land at `[0,50]`, `[0,140]`
  (outer still 0) and `[0,300]`, and `tests/interaction.rs`'s three wheel tests.

### 11. hit testing ignored the overflow clip, the border radius, and `pointer-events` on the element itself

* **Where:** `src/node/node.rs` (the new `Clip` and `Node::clip_shape`, and `hit_inner` taking the
  ancestor clip and testing it), `src/document.rs` (`hit_with_scrollbar` passes `None`).
* **Why:** `hit_inner` descended into children whose box lay outside a clipping ancestor, so a
  click in the clipped-away part of a scroll panel hit the content that was not painted there: an
  `overflow: hidden` HUD card with a tall list inside it would swallow clicks meant for the game
  behind it. It also compared points against each element's plain rectangle, so the corner a
  `border-radius` rounds away was still a hit, and the clip an ancestor establishes was never
  intersected with a child's. `clip_shape` is the one place that knows both halves — the padding
  box when the node clips its overflow, the border-radius curve always, since a rounded corner is
  not painted — and the clip is threaded down the same walk, in the coordinate space each level is
  already tested in, so transforms need no special case. `pointer-events: none` was already
  honoured (hunk-free); the element's own rounded box was not.
* **Proves it:** `clipped-hit-test` (four clicks: inside the clip, outside it, in the rounded
  corner, in the circle) and `transform-hit-test-and-pointer-events`, plus five tests in
  `tests/interaction.rs`. Dropping the clip test, the radius test, or the inverse transform fails
  one of them each.

### 12. `<button disabled>` was focusable, because an empty attribute value does not parse as `false`

* **Where:** `src/node/element.rs` (`flush_is_focussable`).
* **Why:** `attr_parsed::<bool>("disabled")` on `<button disabled>` — the attribute HTML writes
  with no value — returns `None`, and `unwrap_or(false)` read that as "not disabled". So a
  disabled button was in the tab order, and `focus-traversal-and-activation` stopped on it. What
  disables a control is the attribute's presence, which the sibling `ElementState::DISABLED` code
  already used (`has_attr`).
* **Proves it:** `focus-traversal-and-activation` — Tab visits 1, 3, 4 and 6 and never the disabled
  2 — and `tests/interaction.rs::tab_stops_at_focusable_elements_in_document_order`.

## `parley-0.11.1` — 124 added code lines

The overage here is honest: ~25 of hunk 1's lines are the shared `leading_box` helper, which
replaced two copies of the same half-leading arithmetic. Hunk 1 is the separable one — dropping it
reverts `box-model-and-sizing` and changes nothing else — and hunk 2 below is 10 lines on its own.

Line counts are added lines against the crates.io source of the same version, comments and blank
lines excluded: `diff -ru ~/.cargo/registry/src/*/<crate> <crate>`.

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

### 2. a line box could not be moved along the block axis

* **Where:** `src/layout/layout.rs` (the new `Layout::shift_lines`).
* **Why:** a container whose content box is taller than its content aligns that content rather than
  growing to fill the box — a `<button>` centres its label (blitz-dom hunk 6). The line boxes are
  where the content's geometry lives, so moving them there reaches every consumer at once (painting,
  hit testing, `getClientRects()`) instead of an offset each of them would have to add and forget.
  The layout's own `height()` is left alone: it is the extent of the content, not of the box.
* **Proves it:** `button-centring` and `state-selectors-and-environment` (0.9769 and 0.9650 without
  it, both fixtures fail).
