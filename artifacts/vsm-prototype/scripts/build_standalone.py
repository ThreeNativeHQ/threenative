#!/usr/bin/env python3
"""Build a single-file ThreeNative virtual-shadow demo without network dependencies."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MODULES = {
    "physical": "src/core/PhysicalPagePool.js",
    "clipmap": "src/core/DirectionalClipmap.js",
    "demand": "src/core/ReceiverDemandPass.js",
    "invalidation": "src/core/ShadowInvalidationTracker.js",
    "shadow_map": "src/render/VirtualShadowMap.js",
    "shadow_material": "src/render/VirtualShadowMaterial.js",
    "avenue": "src/demo/createAvenueScene.js",
    "stock_view": "src/demo/createStockShadowView.js",
    "virtual_view": "src/demo/createVirtualShadowView.js",
    "ui": "src/demo/ui.js",
    "boot": "src/demo/boot.js",
}


def encoded_file(relative_path: str) -> str:
    return json.dumps((ROOT / relative_path).read_text(encoding="utf-8"))


def build_runtime_script() -> str:
    sources = {name: encoded_file(path) for name, path in MODULES.items()}
    three_source = encoded_file("vendor/three.module.js")

    return f"""
const moduleSource = {{
  three: {three_source},
  physical: {sources['physical']},
  clipmap: {sources['clipmap']},
  demand: {sources['demand']},
  invalidation: {sources['invalidation']},
  shadowMap: {sources['shadow_map']},
  shadowMaterial: {sources['shadow_material']},
  avenue: {sources['avenue']},
  stockView: {sources['stock_view']},
  virtualView: {sources['virtual_view']},
  ui: {sources['ui']},
  boot: {sources['boot']},
}};

function createModuleURL(source, name) {{
  const decorated = `${{source}}\n//# sourceURL=threenative-vsm/${{name}}`;
  return URL.createObjectURL(new Blob([decorated], {{ type: 'text/javascript' }}));
}}

function rewrite(source, replacements) {{
  let result = source;
  for (const [specifier, url] of Object.entries(replacements)) {{
    result = result.split(`'${{specifier}}'`).join(JSON.stringify(url));
    result = result.split(`"${{specifier}}"`).join(JSON.stringify(url));
  }}
  return result;
}}

const urls = {{}};
urls.three = createModuleURL(moduleSource.three, 'three.module.js');
urls.physical = createModuleURL(moduleSource.physical, 'PhysicalPagePool.js');
urls.clipmap = createModuleURL(rewrite(moduleSource.clipmap, {{
  './PhysicalPagePool.js': urls.physical,
}}), 'DirectionalClipmap.js');
urls.demand = createModuleURL(moduleSource.demand, 'ReceiverDemandPass.js');
urls.invalidation = createModuleURL(moduleSource.invalidation, 'ShadowInvalidationTracker.js');
urls.shadowMap = createModuleURL(rewrite(moduleSource.shadowMap, {{
  '../core/DirectionalClipmap.js': urls.clipmap,
  '../core/PhysicalPagePool.js': urls.physical,
  '../core/ReceiverDemandPass.js': urls.demand,
  '../core/ShadowInvalidationTracker.js': urls.invalidation,
}}), 'VirtualShadowMap.js');
urls.shadowMaterial = createModuleURL(moduleSource.shadowMaterial, 'VirtualShadowMaterial.js');
urls.avenue = createModuleURL(moduleSource.avenue, 'createAvenueScene.js');
urls.stockView = createModuleURL(rewrite(moduleSource.stockView, {{
  './createAvenueScene.js': urls.avenue,
}}), 'createStockShadowView.js');
urls.virtualView = createModuleURL(rewrite(moduleSource.virtualView, {{
  '../render/VirtualShadowMap.js': urls.shadowMap,
  '../render/VirtualShadowMaterial.js': urls.shadowMaterial,
  './createAvenueScene.js': urls.avenue,
}}), 'createVirtualShadowView.js');
urls.ui = createModuleURL(moduleSource.ui, 'ui.js');
urls.boot = createModuleURL(rewrite(moduleSource.boot, {{
  './createStockShadowView.js': urls.stockView,
  './createVirtualShadowView.js': urls.virtualView,
  './ui.js': urls.ui,
}}), 'boot.js');

try {{
  const [THREE, app] = await Promise.all([import(urls.three), import(urls.boot)]);
  await app.boot(THREE, window.__TN_VSM_CONFIG__ || {{}});
}} catch (error) {{
  window.__TN_VSM_ERROR__ = String(error.stack || error);
  document.body.dataset.error = 'true';
  console.error(error);
}}
""".strip()


def main() -> None:
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    styles = (ROOT / "styles.css").read_text(encoding="utf-8")

    html = re.sub(
        r'<link\s+rel="stylesheet"\s+href="\./styles\.css"\s*/?>',
        f"<style>{styles}</style>",
        index,
        count=1,
    )
    html = re.sub(
        r'<script\s+type="module">.*?</script>',
        "",
        html,
        count=1,
        flags=re.DOTALL,
    )
    runtime = build_runtime_script()
    injection = (
        "<script>window.__TN_VSM_CONFIG__ = {};</script>\n"
        f"<script type=\"module\">\n{runtime}\n</script>\n"
    )
    html = html.replace("</body>", f"{injection}</body>", 1)

    output = ROOT / "standalone.html"
    output.write_text(html, encoding="utf-8")
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
