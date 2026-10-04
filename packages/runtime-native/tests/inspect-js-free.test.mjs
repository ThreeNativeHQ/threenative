import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  findLibraryFindings,
  findResourceFindings,
  findScriptMarkers,
  findSymbolFindings,
  inspect,
} from "../scripts/inspect-js-free.mjs";

const work = mkdtempSync(join(tmpdir(), "tn-js-free-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function compile(name, source) {
  const file = join(work, `${name}.cpp`);
  const binary = join(work, name);
  writeFileSync(file, source);
  execFileSync("c++", ["-O0", "-o", binary, file]);
  return binary;
}

describe("inspect-js-free", () => {
  it("names every VM symbol family, including an undefined import", () => {
    const families = findSymbolFindings([
      "0000 T v8::Isolate::New(v8::Isolate::CreateParams const&)",
      "U JS_NewRuntime",
      "U JSEvaluateScript",
      "0000 T facebook::hermes::HermesRuntime::create()",
      "U webkit_web_view_new",
      "0000 u mystral::runtime_scripts::k_fetch_polyfill",
    ]).map((finding) => finding.family);
    expect(families).toEqual(["v8", "quickjs", "javascriptcore", "hermes", "webview", "embedded-runtime-scripts"]);
    expect(findSymbolFindings(["0000 T dawn::native::Instance::Create()", "U wgpuDeviceCreateBuffer"])).toEqual([]);
  });

  it("flags VM and web-view libraries, scripts in the binary and script resources", () => {
    expect(findLibraryFindings(["libwebkit2gtk-4.1.so.0", "libv8.so", "libm.so.6", "libSDL3.so.0"])).toHaveLength(2);
    expect(findScriptMarkers(Buffer.from('x//# sourceMappingURL=game.js.map'))).toHaveLength(1);
    expect(findScriptMarkers(Buffer.from("fn main() -> i32 { return 0; }"))).toEqual([]);
    expect(findResourceFindings(["game.js", "assets/a.glb", "v8/snapshot_blob.bin", "app.hbc"])).toHaveLength(3);
  });

  it("fails a compiled binary that carries a v8:: symbol and passes one that does not", () => {
    const red = compile("red", "namespace v8 { int Isolate_New() { return 1; } }\nint main() { return v8::Isolate_New() - 1; }\n");
    const green = compile("green", "int main() { return 0; }\n");
    const redReport = inspect({ binary: red });
    expect(redReport.jsFree).toBe(false);
    expect(redReport.findings.map((finding) => finding.family)).toContain("v8");
    expect(inspect({ binary: green }).jsFree).toBe(true);
  });

  it("fails a packaged resource directory that carries a script bundle", () => {
    const green = compile("packaged", "int main() { return 0; }\n");
    const resources = join(work, "resources");
    mkdirSync(join(resources, "assets"), { recursive: true });
    writeFileSync(join(resources, "assets", "game.js"), "export default 1;\n");
    expect(inspect({ binary: green, resources }).findings).toEqual([{ kind: "resource", evidence: join("assets", "game.js") }]);
  });

  const gateE = process.env.TN_GATE_E_BINARY;
  it.skipIf(!gateE || !existsSync(gateE))("passes the gate-E driver named by TN_GATE_E_BINARY", () => {
    expect(inspect({ binary: gateE }).jsFree).toBe(true);
  });
});
