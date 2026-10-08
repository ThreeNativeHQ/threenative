/**
 * PRD-500 phase 1: the catalog and the advertised native surface are one list.
 *
 * The catalog is the contract; `capabilities.json` is what an agent reads before it writes a game.
 * If either could hold a name the other does not, a game would be told a native capability exists
 * because one file says so while the other says nothing — the failure §8.1 forbids.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAPABILITY_MANIFEST_MIRROR_PATH,
  CAPABILITY_MANIFEST_RELATIVE_PATH,
  buildCapabilityManifest,
} from "../../../scripts/build-capability-manifest.js";
import { capabilityDigest, loadCatalog, supportedNativeSymbols } from "../src/catalog.js";

/** The catalog and both manifests live in the repository, and vitest runs from its root. */
const REPO = process.cwd();
const HEADER = path.join(REPO, "packages/runtime-native/include/threenative/abi/tn_abi.h");

interface IManifest {
  readonly native?: {
    readonly catalog: string;
    readonly compatibilityContract: number;
    readonly engineAbi: number;
    readonly scene: number;
    readonly shaderPackage: number;
    readonly symbols: readonly { readonly symbol: string }[];
  };
}

function committedManifest(relative: string): IManifest {
  return JSON.parse(readFileSync(path.join(REPO, relative), "utf8")) as IManifest;
}

describe("the advertised native surface", () => {
  it("names every supported catalog entry and nothing else", () => {
    const catalog = loadCatalog(REPO);
    // Empty until an engine work package proves an entry natively; the two lists must still agree.
    const advertised = supportedNativeSymbols(catalog).map((entry) => entry.symbol);

    for (const relative of [CAPABILITY_MANIFEST_RELATIVE_PATH, CAPABILITY_MANIFEST_MIRROR_PATH]) {
      const native = committedManifest(relative).native;
      expect(native, relative).toBeDefined();
      const names = (native?.symbols ?? []).map((entry) => entry.symbol);
      expect(
        names.filter((name) => !advertised.includes(name)),
        relative,
      ).toEqual([]);
      expect(
        advertised.filter((name) => !names.includes(name)),
        relative,
      ).toEqual([]);
    }
  });

  it("advertises a supported entry and never a partial or unsupported one", () => {
    const catalog = loadCatalog(REPO);
    type Entry = (typeof catalog.entries)[number];
    const [first, second, third] = catalog.entries as readonly [Entry, Entry, Entry];
    const probe = {
      ...catalog,
      entries: [
        { ...first, status: { kind: "supported" as const } },
        { ...second, status: { kind: "partial" as const, gaps: ["native-not-implemented"] } },
        { ...third, status: { kind: "unsupported" as const, diagnostic: "TN_PROBE" } },
      ],
    };
    expect(supportedNativeSymbols(probe).map((entry) => entry.symbol)).toEqual([first.name]);
    expect(capabilityDigest(probe)).not.toBe(capabilityDigest({ ...probe, entries: [] }));
  });

  it("carries the catalog's four version numbers and points at the catalog", () => {
    const catalog = loadCatalog(REPO);
    for (const relative of [CAPABILITY_MANIFEST_RELATIVE_PATH, CAPABILITY_MANIFEST_MIRROR_PATH]) {
      expect(committedManifest(relative).native, relative).toMatchObject({
        catalog: "packages/three-native/api/catalog.json",
        compatibilityContract: catalog.abi.compatibilityContract,
        engineAbi: catalog.abi.engine,
        scene: catalog.abi.scene,
        shaderPackage: catalog.abi.shaderPackage,
      });
    }
  });

  it("is generated from the catalog rather than hand-written", () => {
    const catalog = loadCatalog(REPO);
    expect(buildCapabilityManifest(REPO).native).toEqual({
      catalog: "packages/three-native/api/catalog.json",
      compatibilityContract: catalog.abi.compatibilityContract,
      engineAbi: catalog.abi.engine,
      scene: catalog.abi.scene,
      shaderPackage: catalog.abi.shaderPackage,
      symbols: supportedNativeSymbols(catalog),
    });
  });

  it("counts and digests the same surface the ABI header publishes", () => {
    const catalog = loadCatalog(REPO);
    const header = readFileSync(HEADER, "utf8");
    expect(header).toContain(
      `#define TN_CAPABILITY_COUNT ${supportedNativeSymbols(catalog).length}u`,
    );
    expect(header).toContain(
      `#define TN_CAPABILITY_DIGEST 0x${capabilityDigest(catalog).toString(16)}ull`,
    );
  });
});
