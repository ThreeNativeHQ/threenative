// The Core HUD browser-oracle corpus. One fixture = one element tree + one stylesheet, rendered by
// pinned headless Chromium and by the native CSS engine from the same source, then compared (see
// oracle.mjs). Trees are data so both sides build from one definition: HTML for Chromium, the
// closed mutation protocol for native. Every fixture declares the bundled font; none relies on a
// system font, because Chromium and the engine resolve different system sans faces.

const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children });
const t = (text) => ({ text });

export const FONT = `
@font-face{font-family:Noto;font-weight:400;src:url(NotoSans-Regular.ttf)}
@font-face{font-family:Noto;font-weight:700;src:url(NotoSans-Bold.ttf)}
html,body{margin:0;padding:0}
body{font-family:Noto;font-size:16px;line-height:24px;color:#fff;background:#18181b}
`;

export const FIXTURES = [
  // ---- cascade and selectors -------------------------------------------------------------
  {
    name: "cascade-order-and-importance",
    size: [320, 200],
    css: `
      .a{width:100px;height:40px;background:#f00}
      .b{background:#0f0}
      .c{background:#00f !important}
      .c{background:#ff0}
      #id1{width:140px}
      div.a{height:50px}
      .a.b{margin-top:10px}
      @layer base{.l{width:60px;height:30px;background:#f0f}}
      @layer over{.l{background:#0ff}}
      .l{background:#888}
    `,
    tree: [
      h("div", { class: "a" }),
      h("div", { class: "a b" }),
      h("div", { class: "a c", id: "id1" }),
      h("div", { class: "l" }),
    ],
  },
  {
    name: "selectors-structural",
    size: [320, 240],
    css: `
      ul{margin:0;padding:0;display:flex;gap:4px}
      li{list-style:none;width:30px;height:30px;background:#444}
      li:first-child{background:#f00}
      li:last-child{background:#0f0}
      li:nth-child(2n+2){height:50px}
      li:not(.x){border-bottom:4px solid #ff0}
      li + li.y{width:60px}
      li ~ li[data-k="z"]{background:#00f}
      :is(.p,.q) > span{display:block;width:20px;height:20px;background:#0ff}
      :where(.p) span{margin-left:10px}
      .row{display:flex;gap:6px;margin-top:8px}
    `,
    tree: [
      h(
        "ul",
        {},
        h("li", {}),
        h("li", { class: "y" }),
        h("li", { "data-k": "z" }),
        h("li", { class: "x" }),
        h("li", {}),
      ),
      h(
        "div",
        { class: "row" },
        h("div", { class: "p" }, h("span")),
        h("div", { class: "q" }, h("span")),
      ),
    ],
  },
  {
    name: "variables-and-inheritance",
    size: [320, 160],
    css: `
      :root{--w:120px;--c:#06f;--gap:calc(var(--w) / 4)}
      .box{width:var(--w);height:40px;background:var(--c);margin-bottom:var(--gap)}
      .over{--c:#f60;--w:80px}
      .cyc{--a:var(--b);--b:var(--a);width:var(--a, 50px);height:20px;background:#0c0}
      .inh{color:#ff0;font-weight:700;letter-spacing:2px}
    `,
    tree: [
      h("div", { class: "box" }),
      h("div", { class: "box over" }),
      h("div", { class: "cyc" }),
      h("p", { class: "inh", style: "margin:8px 0 0" }, t("Inherited")),
    ],
  },
  // ---- box layout ------------------------------------------------------------------------
  {
    name: "box-model-and-sizing",
    size: [360, 260],
    css: `
      .b{box-sizing:border-box;width:200px;padding:10px 20px 30px 5px;border:3px solid #fff;margin:6px 0 0 12px;background:#335;height:80px}
      .c{box-sizing:content-box;width:50%;min-width:120px;max-width:140px;height:30px;padding:4px;margin:6px 0 0 12px;background:#353}
      .d{width:60%;aspect-ratio:2/1;margin:6px 0 0 12px;background:#533}
      .e{display:inline-block;width:70px;height:30px;background:#0aa;margin:6px 0 0 12px}
      .f{display:inline-block;width:70px;height:30px;background:#aa0;margin:6px 0 0 6px}
    `,
    tree: [
      h("div", { class: "b", id: "b" }),
      h("div", { class: "c" }),
      h("div", { class: "d" }),
      h("div", {}, h("span", { class: "e" }), h("span", { class: "f" })),
    ],
  },
  {
    name: "positioning",
    size: [360, 240],
    css: `
      .stage{position:relative;width:300px;height:200px;margin:10px;background:#222}
      .rel{position:relative;left:12px;top:8px;width:60px;height:40px;background:#f55}
      .abs{position:absolute;right:10px;bottom:10px;width:80px;height:50px;background:#5f5}
      .abs2{position:absolute;left:20px;top:100px;right:200px;height:30px;background:#55f}
      .fix{position:fixed;left:5px;bottom:5px;width:40px;height:20px;background:#ff5;z-index:2}
      .z{position:absolute;left:50px;top:50px;width:60px;height:60px;background:#5ff;z-index:1}
    `,
    tree: [
      h(
        "div",
        { class: "stage" },
        h("div", { class: "rel" }),
        h("div", { class: "abs" }),
        h("div", { class: "abs2" }),
        h("div", { class: "z" }),
      ),
      h("div", { class: "fix" }),
    ],
  },
  {
    name: "flex-shrink-wrap-align",
    size: [360, 300],
    css: `
      .row{display:flex;width:300px;gap:8px;margin-bottom:8px;background:#222}
      .row > div{height:30px;background:#58f}
      .s > div{width:150px;flex-shrink:1}
      .s > div + div{flex-shrink:3;background:#f85}
      .g > div{flex:1 1 0}
      .g > div + div{flex:2 1 0;background:#f85}
      .basis > div{flex-basis:90px;flex-grow:0}
      .wrap{flex-wrap:wrap}
      .wrap > div{width:110px;margin-bottom:4px}
      .col{flex-direction:column;height:120px;align-items:center;justify-content:space-between;width:100px}
      .col > div{width:40px;height:20px}
      .ord > div:nth-child(1){order:3}
      .ord > div:nth-child(3){order:1;background:#f85}
      .am > div{width:50px}
      .am > div:nth-child(2){margin-left:auto}
    `,
    tree: [
      h("div", { class: "row s" }, h("div"), h("div")),
      h("div", { class: "row g" }, h("div"), h("div")),
      h("div", { class: "row basis" }, h("div"), h("div"), h("div")),
      h("div", { class: "row wrap" }, h("div"), h("div"), h("div"), h("div")),
      h("div", { class: "row col" }, h("div"), h("div"), h("div")),
      h(
        "div",
        { class: "row ord" },
        h("div", { style: "width:40px" }),
        h("div", { style: "width:40px" }),
        h("div", { style: "width:40px" }),
      ),
      h("div", { class: "row am" }, h("div"), h("div")),
    ],
  },
  {
    name: "grid-tracks-and-placement",
    size: [380, 300],
    css: `
      .g{display:grid;width:360px;gap:6px 10px;background:#222;margin-bottom:8px}
      .g > div{background:#4a8;min-height:24px}
      .t1{grid-template-columns:80px 1fr 2fr}
      .t2{grid-template-columns:repeat(3,minmax(60px,1fr));grid-auto-rows:30px}
      .t2 > div:nth-child(1){grid-column:span 2}
      .t2 > div:nth-child(2){grid-row:span 2;background:#a48}
      .t3{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}
      .t4{grid-template-columns:1fr 1fr;grid-template-rows:20px auto}
    `,
    tree: [
      h("div", { class: "g t1" }, h("div"), h("div"), h("div")),
      h("div", { class: "g t2" }, h("div"), h("div"), h("div"), h("div"), h("div")),
      h("div", { class: "g t3" }, h("div"), h("div"), h("div"), h("div"), h("div")),
      h("div", { class: "g t4" }, h("div", { style: "height:40px" }), h("div"), h("div"), h("div")),
    ],
  },
  // ---- typography ------------------------------------------------------------------------
  {
    name: "text-wrap-weights-spacing",
    size: [360, 360],
    css: `
      p{margin:0 0 8px;width:200px;background:#2a2a30}
      .w7{font-weight:700}
      .ls{letter-spacing:3px}
      .lh{line-height:40px}
      .ta{text-align:center}
      .tr{text-align:right}
      .pre{white-space:pre-wrap}
      .big{font-size:22px;line-height:28px}
    `,
    tree: [
      h("p", {}, t("The quick brown fox jumps over the lazy dog and keeps running.")),
      h("p", { class: "w7" }, t("Bold weight wraps differently from regular text here.")),
      h("p", { class: "ls ta" }, t("Spaced and centred")),
      h("p", { class: "lh tr" }, t("Tall line right")),
      h("p", { class: "pre" }, t("Keep   spaces\nand newlines")),
      h("p", { class: "big" }, t("Inventário: ação, coração, não e açúcar — pt-BR sample.")),
    ],
  },
  {
    // Strict: a missing "..." glyph is a semantic failure, not a rasteriser difference, and on a
    // frame this small it must cost more than the whole-frame glyph allowance can hide.
    name: "text-ellipsis",
    size: [160, 48],
    strict: true,
    css: "p{margin:0;background:#2a2a30}.ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:120px}",
    tree: [h("p", { class: "ell" }, t("An ellipsised line that is far too long"))],
  },
  {
    name: "inline-runs",
    size: [360, 140],
    css: "p{margin:0;width:260px;background:#2a2a30}.b{font-weight:700;color:#ff0}.s{font-size:12px;color:#0ff}",
    tree: [
      h(
        "p",
        {},
        t("Mixed "),
        h("span", { class: "b" }, t("bold run")),
        t(" and "),
        h("span", { class: "s" }, t("small cyan run")),
        t(" in one wrapped paragraph of text."),
      ),
    ],
  },
  // ---- paint -----------------------------------------------------------------------------
  {
    name: "paint-radius-border-shadow",
    size: [380, 300],
    css: `
      .wrap{display:flex;flex-wrap:wrap}.p{width:100px;height:60px;margin:10px;background:#36c}
      .r1{border-radius:20px}
      .r2{border-radius:30px 4px 30px 4px}
      .bd{border:4px solid #fc0;border-left-color:#f0c;border-top-width:8px;border-radius:12px}
      .sh{box-shadow:0 6px 12px rgba(0,0,0,.6)}
      .sh2{box-shadow:0 0 0 4px #f60, 8px 8px 0 #0c6}
      .out{outline:3px solid #fff;outline-offset:3px}
      .cl{overflow:hidden;border-radius:24px;background:#222}
      .cl > div{width:140px;height:20px;background:#f06;margin-top:10px}
    `,
    tree: [
      h(
        "div",
        { class: "wrap" },
        h("div", { class: "p r1" }),
        h("div", { class: "p r2" }),
        h("div", { class: "p bd" }),
        h("div", { class: "p sh" }),
        h("div", { class: "p sh2" }),
        h("div", { class: "p out" }),
        h("div", { class: "p cl" }, h("div")),
      ),
    ],
  },
  {
    name: "paint-gradient-opacity-alpha",
    size: [380, 220],
    css: `
      .wrap{display:flex;flex-wrap:wrap}.p{width:110px;height:70px;margin:10px}
      .g1{background:linear-gradient(90deg,#f00,#00f)}
      .g2{background:linear-gradient(135deg,#ff0 0%,#0c0 50%,#06f 100%)}
      .g3{background:linear-gradient(to bottom,rgba(255,255,255,.9),rgba(255,255,255,0))}
      .o{background:#f06;opacity:.5}
      .og{opacity:.6;background:#0af}
      .og > div{width:50px;height:30px;background:#fa0;margin:10px}
      .ok{background:oklch(62% .2 250)}
      .al{background:rgb(255 0 0 / 40%)}
    `,
    tree: [
      h(
        "div",
        { class: "wrap" },
        h("div", { class: "p g1" }),
        h("div", { class: "p g2" }),
        h("div", { class: "p g3" }),
        h("div", { class: "p o" }),
        h("div", { class: "p og" }, h("div")),
        h("div", { class: "p ok" }),
        h("div", { class: "p al" }),
      ),
    ],
  },
  {
    name: "state-selectors-and-environment",
    size: [320, 160],
    css: `
      button{font:inherit}
      .btn{display:block;width:100px;height:36px;margin:8px;background:#2563eb;border:0;color:#fff}
      .btn:disabled{background:#555}
      .btn[aria-pressed="true"]{background:#16a34a}
      .grp:hover .kid{background:#f00}
      .kid{width:40px;height:20px;margin:8px;background:#0a0}
      @media (min-width:300px){.mq{background:#a0a;width:60px;height:20px;margin:8px}}
      @media (max-width:100px){.mq{background:#000}}
      @media (prefers-reduced-motion:reduce){.rm{background:#0ff}}
      .rm{width:30px;height:20px;margin:8px;background:#f0f}
    `,
    tree: [
      h("button", { class: "btn", type: "button" }, t("Go")),
      h("button", { class: "btn", type: "button", disabled: "" }, t("Off")),
      h("button", { class: "btn", type: "button", "aria-pressed": "true" }, t("On")),
      h("div", { class: "grp" }, h("div", { class: "kid" })),
      h("div", { class: "mq" }),
      h("div", { class: "rm" }),
    ],
  },
  // ---- user-agent defaults -----------------------------------------------------------------
  // One fixture for the UA sheet: the fixture stylesheet styles nothing here, so every box is
  // that tag's user-agent default. A flex column keeps sibling margins from collapsing, and the
  // inline labels are one character each: Chromium rounds every glyph advance to a whole pixel
  // (FreeType hinting, proven in the report) while this engine keeps the font's fractional
  // advances, so a longer label would measure hinting drift rather than UA defaults.
  {
    name: "ua-defaults",
    size: [360, 470],
    css: `
      .col{display:flex;flex-direction:column}
    `,
    tree: [
      h(
        "div",
        { class: "col" },
        h("h1", {}, t("H1")),
        h("h2", {}, t("H2")),
        h("h3", {}, t("H3")),
        h("h4", {}, t("H4")),
        h("h5", {}, t("H5")),
        h("h6", {}, t("H6")),
        h("p", {}, t("p")),
        h("ul", {}, h("li", {}, t("one")), h("li", {}, t("two"))),
        h("ol", {}, h("li", {}, t("one")), h("li", {}, t("two"))),
        h("label", {}, t("label")),
        h(
          "div",
          {},
          t(" "),
          h("a", {}, t("a")),
          t(" "),
          h("strong", {}, t("s")),
          t(" "),
          h("em", {}, t("e")),
          t(" "),
          h("b", {}, t("b")),
          t(" "),
          h("i", {}, t("i")),
        ),
        h("button", { type: "button" }, t("Btn")),
      ),
    ],
  },
];
