import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
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
    expect(findSymbolFindings(["U _JS_NewRuntime", "U _JSEvaluateScript"])).toHaveLength(2);
  });

  it("flags VM and web-view libraries, scripts in the binary and script resources", () => {
    expect(findLibraryFindings(["libwebkit2gtk-4.1.so.0", "libv8.so", "libm.so.6", "libSDL3.so.0"])).toHaveLength(2);
    expect(findScriptMarkers(Buffer.from('x//# sourceMappingURL=game.js.map'))).toHaveLength(1);
    expect(findScriptMarkers(Buffer.from("fn main() -> i32 { return 0; }"))).toEqual([]);
    expect(findResourceFindings(["game.js", "assets/a.glb", "v8/snapshot_blob.bin", "app.hbc"])).toHaveLength(3);
    expect(findLibraryFindings(["C:\\app\\v8.dll"])).toHaveLength(1);
    expect(findResourceFindings(["v8\\snapshot_blob.bin"])).toHaveLength(1);
  });

  it("inspects MSVC .exe public symbols and PE imports, including static and imported VMs", () => {
    const binary = join(work, "player.exe");
    writeFileSync(binary, "MZ");
    const map = join(work, "player.map");
    const dawn = " 0001:00000000 ?Create@Instance@native@dawn@@ 0000000140001000 f dawn.lib:instance.obj\n";
    writeFileSync(map, dawn);
    const run = vi.fn(() => "Dump of file player.exe\n  KERNEL32.dll\n    123 ExitProcess\n");
    const report = inspect({ binary }, { platform: "win32", run });
    expect(run).toHaveBeenCalledWith("dumpbin", ["/imports", binary]);
    expect(report).toMatchObject({ jsFree: true, backend: "dawn", libraries: ["KERNEL32.dll"] });
    writeFileSync(map, `${dawn} 0001:00000010 ?New@Isolate@v8@@ 0000000140001010 f v8.lib:isolate.obj\n`);
    expect(inspect({ binary }, { platform: "win32", run }).findings).toContainEqual(
      expect.objectContaining({ kind: "symbol", family: "v8" }),
    );
    writeFileSync(map, dawn);
    run.mockReturnValue("  WebView2Loader.dll\n    123 CreateCoreWebView2Environment\n  engine.dll\n    124 JS_NewRuntime\n");
    expect(inspect({ binary }, { platform: "win32", run }).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "symbol", family: "quickjs" }),
        { kind: "library", evidence: "WebView2Loader.dll" },
      ]),
    );
    writeFileSync(map, "Publics by Value\n(no symbols)\n");
    expect(() => inspect({ binary }, { platform: "win32", run })).toThrow(/TN_JS_FREE_NO_SYMBOLS/);
    rmSync(map);
    expect(() => inspect({ binary }, { platform: "win32", run })).toThrow(/ENOENT/);
  });

  it("uses Mach-O tools and refuses JavaScriptCore framework linkage", () => {
    const binary = join(work, "macho-player");
    writeFileSync(binary, "Mach-O fixture");
    const run = vi.fn((tool) => tool === "nm"
      ? "0000 T dawn::native::Instance::Create()\n"
      : `${binary}:\n\t/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/JavaScriptCore (compatibility version 1.0.0)\n`);
    expect(inspect({ binary }, { platform: "darwin", run }).jsFree).toBe(false);
    expect(run).toHaveBeenCalledWith("nm", ["-C", binary]);
    expect(run).toHaveBeenCalledWith("otool", ["-L", binary]);
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
