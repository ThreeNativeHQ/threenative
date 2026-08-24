import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { checkNativeShims } from "../check-native-shims.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(manifest: unknown): Promise<string> {
  const root = await makeTempDir("threenative-native-shims-");
  temporaryRoots.push(root);
  await mkdir(path.join(root, "packages/core/src"), { recursive: true });
  await mkdir(path.join(root, "packages/physics/src"), { recursive: true });
  await mkdir(path.join(root, "packages/ui/src"), { recursive: true });
  await mkdir(path.join(root, "packages/playtest/src"), { recursive: true });
  await mkdir(path.join(root, "packages/runtime-native"), { recursive: true });
  await writeFile(
    path.join(root, "packages/core/src/storage.ts"),
    'export const value = localStorage.getItem("value");\n',
  );
  await writeFile(
    path.join(root, "packages/runtime-native/shim-manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  return root;
}

describe("native shim contract", () => {
  it("names an unregistered browser global and the required remedy", async () => {
    const findings = await checkNativeShims(
      await fixtureRoot({ version: 1, shims: [], allowlist: [] }),
    );
    expect(findings.join("\n")).toContain(
      "localStorage is not registered as a native shim or an allowlist reason",
    );
  });

  it("accepts an allowlisted global only when its reason is present", async () => {
    await expect(
      checkNativeShims(
        await fixtureRoot({
          version: 1,
          shims: [],
          allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("checks each manifest evidence backend instead of concatenating runtime sources", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "QuickOnly",
          evidence: "packages/runtime-native/src/js/quickjs_engine.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src/js");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(path.join(runtimeSource, "v8_engine.cpp"), "globalThis.QuickOnly = true;\n");
    const quickjs = path.join(runtimeSource, "quickjs_engine.cpp");
    await writeFile(quickjs, "globalThis.QuickOnly = true;\n");

    await expect(checkNativeShims(root)).resolves.toEqual([]);

    await writeFile(quickjs, "// QuickOnly was removed from this backend.\n");
    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim QuickOnly has no matching runtime installation",
    );
  });

  it("requires shim assignment evidence instead of a global read or comment", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(
      path.join(runtimeSource, "runtime.cpp"),
      "// globalThis.ReadableStream assignment was removed.\nif (typeof globalThis.ReadableStream === 'undefined') {}\n",
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );
  });

  it("does not treat a quoted JavaScript assignment as shim evidence", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(
      path.join(runtimeSource, "runtime.cpp"),
      [
        'const char* streams = R"STREAMS(',
        'const note = "globalThis.ReadableStream = ReadableStream";',
        ')STREAMS";',
      ].join("\n"),
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );
  });

  it("does not treat a JavaScript regex literal as shim evidence", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(
      path.join(runtimeSource, "runtime.cpp"),
      "/globalThis.ReadableStream = ReadableStream/;\n",
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );
  });

  it("does not treat a regex after a class declaration as shim evidence", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(
      path.join(runtimeSource, "runtime.cpp"),
      "class X {} /globalThis.ReadableStream = ReadableStream/.test(source);\n",
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );
  });

  it("does not treat a regex after a class with delimiter-looking extends text as shim evidence", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(
      path.join(runtimeSource, "runtime.cpp"),
      'class X extends registry[";"] {} /globalThis.ReadableStream = ReadableStream/.test(source);\n',
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );
  });

  it("does not treat a regex after a class with a regex literal in extends as shim evidence", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    await writeFile(
      path.join(runtimeSource, "runtime.cpp"),
      "class X extends registry[/;/] {} /globalThis.ReadableStream = ReadableStream/.test(source);\n",
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );
  });

  it("masks regex expression statements after closing conditions without masking division", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    const runtimeFile = path.join(runtimeSource, "runtime.cpp");
    await writeFile(
      runtimeFile,
      [
        "if (/\\)/.test(source)) /globalThis.ReadableStream = ReadableStream/.test(source);",
        "if (ready) /globalThis.ReadableStream = ReadableStream/.test(source);",
        "if (ready) {",
        "  noop();",
        "}",
        "/globalThis.ReadableStream = ReadableStream/.test(source);",
      ].join("\n"),
    );

    let findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );

    for (const division of [
      "const quotient = (value) / globalThis.ReadableStream = ReadableStream / 2;",
      "const objectQuotient = { value: 1 } / globalThis.ReadableStream = ReadableStream / 2;",
    ]) {
      await writeFile(runtimeFile, division);
      findings = await checkNativeShims(root);
      expect(findings).toEqual([]);
    }
  }, 30_000);

  it("preserves active backend setter evidence outside quoted literals", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    const runtimeFile = path.join(runtimeSource, "runtime.cpp");
    for (const form of [
      'setGlobalProperty("ReadableStream", value);',
      'Object.defineProperty(globalThis, "ReadableStream", {});',
      'context->Global()->Set(context, "ReadableStream");',
      'JS_SetPropertyStr(context, global, "ReadableStream", value);',
    ]) {
      await writeFile(runtimeFile, form);
      await expect(checkNativeShims(root)).resolves.toEqual([]);
    }
  }, 30_000);

  it("strips comments inside C++ raw strings before matching shim assignments", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [
        {
          name: "ReadableStream",
          evidence: "packages/runtime-native/src/runtime.cpp",
        },
      ],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    const runtimeSource = path.join(root, "packages/runtime-native/src");
    await mkdir(runtimeSource, { recursive: true });
    const runtimeFile = path.join(runtimeSource, "runtime.cpp");
    await writeFile(
      runtimeFile,
      [
        'const char* streams = R"STREAMS(',
        "// globalThis.ReadableStream = ReadableStream;",
        ')STREAMS";',
      ].join("\n"),
    );

    let findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "manifest shim ReadableStream has no matching runtime installation",
    );

    await writeFile(
      runtimeFile,
      [
        'const char* streams = R"STREAMS(',
        "globalThis.ReadableStream = ReadableStream;",
        ')STREAMS";',
      ].join("\n"),
    );
    findings = await checkNativeShims(root);
    expect(findings).toEqual([]);
  }, 30_000);

  it("preserves local, imported, property, and DOM type-only exclusions", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    await writeFile(
      path.join(root, "packages/core/src/dom-exclusions.ts"),
      [
        'import { Audio as ThreeAudio } from "three";',
        "const indexedDB = true;",
        "export type Canvas = HTMLCanvasElement;",
        "export const property = { indexedDB: true }.indexedDB;",
        "export const local = indexedDB;",
        "export const imported = ThreeAudio;",
      ].join("\n"),
    );

    await expect(checkNativeShims(root)).resolves.toEqual([]);
  });

  it("detects an unlisted DOM value global and names the required remedy", async () => {
    const root = await fixtureRoot({ version: 1, shims: [], allowlist: [] });
    await writeFile(
      path.join(root, "packages/core/src/indexed-db.ts"),
      "export const database = indexedDB;\n",
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "indexedDB is not registered as a native shim or an allowlist reason; add a host shim or record an allowlist reason",
    );
  });

  it("checks shared physics source for unshimmed browser globals", async () => {
    const root = await fixtureRoot({
      version: 1,
      shims: [],
      allowlist: [{ name: "localStorage", reason: "fixture host provides storage" }],
    });
    await writeFile(
      path.join(root, "packages/physics/src/browser-global.ts"),
      "export const database = indexedDB;\n",
    );

    const findings = await checkNativeShims(root);
    expect(findings.join("\n")).toContain(
      "packages/physics/src/browser-global.ts:1 reads indexedDB; indexedDB is not registered as a native shim or an allowlist reason; add a host shim or record an allowlist reason",
    );
  });
});
