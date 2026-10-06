import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  discoverCases,
  missingExpectationNote,
  parseExpected,
  runMeasured,
  unsupportedThreeImports,
} from "../run-corpus.mjs";
import { buildEngineBridge } from "../three-bridge.mjs";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tn-run-corpus-"));
}

describe("parseExpected", () => {
  it("defaults to exit 0 and keeps the stdout verbatim when there is no exit line", () => {
    const parsed = parseExpected(Buffer.from("22\n3\n"));
    expect(parsed.exit).toBe(0);
    expect(parsed.stdout.toString()).toBe("22\n3\n");
  });

  it("reads a trailing '# exit <n>' line and removes it from the compared stdout", () => {
    const parsed = parseExpected(Buffer.from("odd: 1\n-1\n# exit 3\n"));
    expect(parsed.exit).toBe(3);
    expect(parsed.stdout.toString()).toBe("odd: 1\n-1\n");
  });
});

describe("discoverCases", () => {
  it("lists the entry cases and excludes helper modules imported by them", () => {
    const names = discoverCases();
    expect(names).toContain("imports-cycle");
    expect(names).not.toContain("imports-cycle-inner");
    expect(names).not.toContain("imports-cycle-outer");
    expect(names).toContain("three-fixture");
    expect(names).toContain("unsupported-export");
    expect(names).toContain("callback-cycle");
    expect(names).toContain("dynamic-tsl");
    expect(names).toContain("dynamic-tsl-unsupported");
    expect(names).toContain("import-identity");
    expect(names).toHaveLength(19);
  });

  it("turns a top-level .ts with no .expected into a named failure, not a skip", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "lonely.ts"), "console.log(1)\n");
    fs.writeFileSync(path.join(dir, "paired.ts"), "console.log(2)\n");
    fs.writeFileSync(path.join(dir, "paired.expected"), "2\n# exit 0\n");

    expect(discoverCases(undefined, dir)).toEqual(["lonely", "paired"]);
    expect(missingExpectationNote("lonely", dir)).toContain("TN_NATIVE_TS_EXPECTED_MISSING");
    expect(missingExpectationNote("paired", dir)).toBeUndefined();
  });
});

describe("runMeasured", () => {
  it("reports the child's exact peak RSS and exit, and passes stdout through", async () => {
    const dir = tempDir();
    const hog = path.join(dir, "hog.mjs");
    fs.writeFileSync(
      hog,
      "const chunks = [];\nfor (let i = 0; i < 8; i++) { const u = new Uint8Array(32 * 1024 * 1024); u.fill(i + 1); chunks.push(u); }\nprocess.stdout.write(String(chunks.length) + '\\n');\n",
    );

    const measured = await runMeasured(process.execPath, process.env, [hog]);

    expect(measured.stdout.toString()).toBe("8\n");
    expect(measured.status).toBe(0);
    expect(measured.peakRssBytes).toBeGreaterThan(200 * 1024 * 1024);
  });
});

describe("unsupportedThreeImports", () => {
  const catalog = {
    entries: [
      { name: "Mesh", status: { kind: "supported" } },
      {
        name: "Raycaster",
        status: { kind: "unsupported", diagnostic: "TN_NATIVE_UNSUPPORTED_RAYCASTER" },
      },
    ],
  };

  it("passes supported names, aliases included", () => {
    expect(unsupportedThreeImports('import { Mesh, Mesh as M } from "three";', catalog)).toEqual(
      [],
    );
  });

  it("names each refused import with its specifier and the catalog's diagnostic", () => {
    expect(
      unsupportedThreeImports(
        'import { Mesh, Raycaster } from "three";\nimport { Fog as F } from "three/webgpu";',
        catalog,
      ),
    ).toEqual([
      "TN_NATIVE_TS_UNSUPPORTED_EXPORT three#Raycaster (TN_NATIVE_UNSUPPORTED_RAYCASTER)",
      "TN_NATIVE_TS_UNSUPPORTED_EXPORT three/webgpu#Fog (not in the catalog)",
    ]);
  });

  it("admits only the implemented AOT bindings when the VM catalog refuses them", () => {
    const aot = { "three/tsl": ["float"] };
    expect(unsupportedThreeImports('import { float } from "three/tsl";', catalog, aot)).toEqual([]);
    expect(
      unsupportedThreeImports('import { wgslFn } from "three/tsl";', catalog, aot),
    ).toHaveLength(1);
    expect(unsupportedThreeImports('import { float } from "three";', catalog, aot)).toHaveLength(1);
  });

  it("ignores imports from other modules", () => {
    expect(unsupportedThreeImports('import { Raycaster } from "./local";', catalog)).toEqual([]);
  });
});

describe("unsupported dynamic graph red control", () => {
  it("the unsupported corpus refuses an implementation that succeeds or raises a different code", () => {
    const source = fs.readFileSync(
      new URL("../corpus/dynamic-tsl-unsupported.ts", import.meta.url),
      "utf8",
    );
    const body = source.replace(/^import[^\n]+\n/, "");
    const run = (mod: () => void): void => {
      new Function("float", body)(() => ({ mod }));
    };
    expect(() => run(() => {})).toThrow(/did not raise TN_TSL_DYNAMIC_UNSUPPORTED/);
    expect(() =>
      run(() => {
        throw "WRONG_CODE mod";
      }),
    ).toThrow("WRONG_CODE mod");
    expect(() =>
      run(() => {
        throw "TN_TSL_DYNAMIC_UNSUPPORTED mod";
      }),
    ).not.toThrow();
  });
});

// Internal C++ headers determine the stack allocation sizes of the in-process render host.
describe("engine bridge cache", () => {
  it("rebuilds when an internal engine header is newer than the archive", () => {
    const outDir = tempDir();
    buildEngineBridge({ outDir });
    const cachedTime = Date.now() + 60_000;
    for (const name of ["libtn-three-shim.a", "tn_three_shim.o", "tn_three_hooks.o"]) {
      const file = path.join(outDir, name);
      fs.utimesSync(file, cachedTime / 1000, cachedTime / 1000);
    }
    const stat = fs.statSync;
    const probe = vi.spyOn(fs, "statSync").mockImplementation((...args) => {
      const result = stat(...args);
      if (String(args[0]).endsWith("/engine/renderer/renderer.h"))
        result.mtimeMs = cachedTime + 60_000;
      return result;
    });
    try {
      const archive = buildEngineBridge({ outDir });
      expect(fs.statSync(archive).mtimeMs).toBeLessThan(cachedTime);
    } finally {
      probe.mockRestore();
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
