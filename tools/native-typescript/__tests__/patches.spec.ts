import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import {
  LEDGER_CODE,
  UPSTREAM_KEY,
  applyPatches,
  compareRedToDeclared,
  loadLedger,
  patchKey,
} from "../patches.mjs";

function tempDir(): string {
  return makeTempDirSync("tn-patches-");
}

/** Writes a ledger the loader reads, so each malformed shape is a file, not a mock. */
function ledgerFile(body: string): string {
  const file = path.join(tempDir(), "patches.json");
  fs.writeFileSync(file, body);
  return file;
}

const TWO_PATCHES = JSON.stringify({
  schema: 1,
  patches: [
    { id: "gc-default", file: "patches/gc-default.patch", cases: ["alloc-loop", "closures"] },
    { id: "int32array-ctor", file: "patches/int32array-ctor.patch", cases: ["typed-arrays"] },
  ],
});

describe("loadLedger", () => {
  it("reads the shipped ledger and names zero patches", () => {
    const ledger = loadLedger();

    expect(ledger.patches).toEqual([]);
    expect(ledger.declaredCases).toEqual([]);
  });

  it("collects the minimized cases each patch declares", () => {
    const ledger = loadLedger(ledgerFile(TWO_PATCHES));

    expect(ledger.patches.map((patch: { id: string }) => patch.id)).toEqual([
      "gc-default",
      "int32array-ctor",
    ]);
    expect(ledger.declaredCases).toEqual(["alloc-loop", "closures", "typed-arrays"]);
  });

  it.each([
    ["a file that is not JSON", "{ nope", /is not JSON/u],
    ["an array", "[]", /must hold an object/u],
    ["another schema", '{"schema":2,"patches":[]}', /schema 2, this runner reads 1/u],
    ["no patches array", '{"schema":1}', /no patches array/u],
    [
      "a patch that is not an object",
      '{"schema":1,"patches":[3]}',
      /patches\[0\] is not an object/u,
    ],
    [
      "a patch with no file",
      '{"schema":1,"patches":[{"id":"a","cases":["x"]}]}',
      /patches\[0\] has no file/u,
    ],
    [
      "a patch declaring no minimized case",
      '{"schema":1,"patches":[{"id":"a","file":"p/a.patch","cases":[]}]}',
      /declares no minimized corpus case/u,
    ],
    [
      "a patch declaring a non-string case",
      '{"schema":1,"patches":[{"id":"a","file":"p/a.patch","cases":[7]}]}',
      /declares no minimized corpus case/u,
    ],
    [
      "two patches with one id",
      '{"schema":1,"patches":[{"id":"a","file":"p/a.patch","cases":["x"]},{"id":"a","file":"p/b.patch","cases":["y"]}]}',
      /declares patch id a twice/u,
    ],
  ])("fails closed on %s", (_label, body, expected) => {
    const error = (() => {
      try {
        loadLedger(ledgerFile(body));
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    expect((error as NodeJS.ErrnoException & { code: string }).code).toBe(LEDGER_CODE);
    expect((error as Error).message).toMatch(expected);
  });

  it("fails closed on a missing ledger rather than reading it as no patches", () => {
    expect(() => loadLedger(path.join(tempDir(), "absent.json"))).toThrow(/cannot read/u);
  });
});

describe("patchKey", () => {
  it("keys no patch set as upstream and any patch set as its own tree", () => {
    expect(patchKey()).toBe(UPSTREAM_KEY);
    expect(patchKey([])).toBe(UPSTREAM_KEY);

    const patches = [
      { id: "b", file: "patches/b.patch" },
      { id: "a", file: "patches/a.patch" },
    ];
    expect(patchKey(patches)).toMatch(/^patched-[a-f0-9]{16}$/u);
    // The key names the set, not its order in the ledger.
    expect(patchKey(patches)).toBe(patchKey([...patches].reverse()));
    expect(patchKey(patches)).not.toBe(patchKey([{ ...patches[1] }]));
  });
});

describe("applyPatches", () => {
  it("applies a patch inside the toolchain tree and refuses one that does not take", () => {
    const tree = tempDir();
    fs.writeFileSync(path.join(tree, "notes.txt"), "upstream\n");
    const patchFile = path.join(tempDir(), "one.patch");
    fs.writeFileSync(
      patchFile,
      "--- a/notes.txt\n+++ b/notes.txt\n@@ -1 +1 @@\n-upstream\n+patched\n",
    );
    const broken = path.join(tempDir(), "broken.patch");
    fs.writeFileSync(broken, "--- a/absent.txt\n+++ b/absent.txt\n@@ -1 +1 @@\n-a\n+b\n");

    expect(applyPatches(tree, [{ id: "one", file: patchFile }])).toBe(1);
    expect(fs.readFileSync(path.join(tree, "notes.txt"), "utf8")).toBe("patched\n");
    expect(() => applyPatches(tree, [{ id: "broken", file: broken }])).toThrow(
      /TN_NATIVE_TS_PATCH: patch broken did not apply/u,
    );
    expect(() =>
      applyPatches(tree, [{ id: "gone", file: path.join(tempDir(), "gone.patch") }]),
    ).toThrow(new RegExp(`${LEDGER_CODE}: patch gone names a missing file`, "u"));
  });

  it("changes nothing for an empty patch set", () => {
    const tree = tempDir();
    expect(applyPatches(tree, [])).toBe(0);
  });
});

describe("compareRedToDeclared", () => {
  it("passes when the red set is the declared set, whatever order it arrives in", () => {
    expect(compareRedToDeclared(["b", "a"], ["a", "b"])).toEqual({
      ok: true,
      missing: [],
      extra: [],
    });
    expect(compareRedToDeclared([], [])).toEqual({ ok: true, missing: [], extra: [] });
  });

  it("names a declared case that stayed green", () => {
    expect(compareRedToDeclared(["a", "b"], ["a"])).toEqual({
      ok: false,
      missing: ["b"],
      extra: [],
    });
  });

  it("names a red case no patch declares", () => {
    expect(compareRedToDeclared(["a"], ["a", "c"])).toEqual({
      ok: false,
      missing: [],
      extra: ["c"],
    });
  });

  it("names both differences at once", () => {
    expect(compareRedToDeclared(["a", "b"], ["c"])).toEqual({
      ok: false,
      missing: ["a", "b"],
      extra: ["c"],
    });
  });
});
