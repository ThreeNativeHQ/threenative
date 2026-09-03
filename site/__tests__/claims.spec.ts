import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claims } from "../src/content/claims.js";
import { features } from "../src/content/features.js";
import { logos } from "../src/content/logos.js";
import { REPO_ROOT, SITE_ROOT, prerenderedPage, readSources, sourceFilesUnder } from "./support.js";

interface ICapabilityManifest {
  readonly entries: readonly { readonly symbol: string }[];
}

async function capabilitySymbols(): Promise<ReadonlySet<string>> {
  const manifest = JSON.parse(
    await readFile(
      path.join(REPO_ROOT, "packages", "create-threenative", "capabilities.json"),
      "utf8",
    ),
  ) as ICapabilityManifest;
  return new Set(manifest.entries.map((entry) => entry.symbol));
}

/** Claim ids a component actually renders, read out of the sources that call into `claims.ts`. */
async function renderedClaimIds(): Promise<ReadonlySet<string>> {
  const componentDir = path.join(SITE_ROOT, "src", "components");
  const sources = await readSources(await sourceFilesUnder(componentDir));
  const ids = new Set<string>(features.map((feature) => feature.claimId));
  for (const source of sources.values()) {
    for (const match of source.matchAll(/claimText\(\s*"([a-z0-9-]+)"\s*\)/gu)) {
      if (match[1] !== undefined) ids.add(match[1]);
    }
    for (const match of source.matchAll(/CHIP_CLAIMS\s*=\s*\[([^\]]*)\]/gu)) {
      for (const quoted of (match[1] ?? "").matchAll(/"([a-z0-9-]+)"/gu)) {
        if (quoted[1] !== undefined) ids.add(quoted[1]);
      }
    }
  }
  return ids;
}

describe("every claim on the page is checkable", () => {
  it("should resolve every claim to live evidence", async () => {
    const symbols = await capabilitySymbols();
    expect(claims.length).toBeGreaterThan(0);
    for (const item of claims) {
      if (item.evidence.kind === "capability") {
        expect(
          symbols.has(item.evidence.symbol),
          `claim ${item.id} cites capability ${item.evidence.symbol}, which the manifest does not export`,
        ).toBe(true);
        continue;
      }
      await expect(
        access(path.join(REPO_ROOT, item.evidence.path)),
        `claim ${item.id} cites ${item.evidence.path}, which is not on disk`,
      ).resolves.toBeUndefined();
    }
  });

  it("should fail when a rendered claim is missing from claims.ts", async () => {
    const rendered = await renderedClaimIds();
    const declared = new Set(claims.map((item) => item.id));
    expect(rendered.size).toBeGreaterThan(0);
    expect([...rendered].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !rendered.has(id))).toEqual([]);
  });

  it("should keep sentence-shaped copy out of the section components", async () => {
    const sections = path.join(SITE_ROOT, "src", "components", "sections");
    const sources = await readSources(await sourceFilesUnder(sections));
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      // A quoted literal with several words and a full stop is prose. Prose belongs in claims.ts.
      const body = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
      for (const match of body.matchAll(/"([^"\n]*?\w+ \w+ \w+ \w+[^"\n]*?\.)"/gu)) {
        offenders.push(`${path.relative(SITE_ROOT, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("should render every claim's text into the prerendered home page", async () => {
    const page = await prerenderedPage("/");
    const rendered = await renderedClaimIds();
    for (const item of claims) {
      if (!rendered.has(item.id)) continue;
      // The prerender escapes the ampersand-free copy verbatim; a missing claim is a missing render.
      expect(
        page.includes(item.text.replaceAll("&", "&amp;")),
        `${item.id} is not on the page`,
      ).toBe(true);
    }
  });

  it("should render no logo wall until an organisation has given permission", async () => {
    for (const logo of logos) {
      expect(logo.permission.length, `${logo.name} has no recorded permission`).toBeGreaterThan(0);
    }
    if (logos.length > 0) return;
    const page = await prerenderedPage("/");
    expect(page).not.toContain("Trusted by innovative teams");
  });
});
