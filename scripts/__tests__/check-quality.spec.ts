import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectQualityFindings,
  loadQualityBaseline,
  runQuality,
  updateQualityBaseline,
} from "../check-quality";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-quality-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "biome.json"), JSON.stringify({ files: { ignore: [] } }));
  await mkdir(path.join(root, "packages", "core", "src"), { recursive: true });
  return root;
}

async function sourceFile(root: string, source: string): Promise<void> {
  await writeFile(path.join(root, "packages", "core", "src", "fixture.ts"), source);
}

describe("quality gate", () => {
  it("reports a file over the threshold and ignores one under it", async () => {
    const root = await fixtureRoot();
    await sourceFile(root, `${"const line = 1;\n".repeat(401)}`);
    const findings = await collectQualityFindings(root);
    expect(findings).toContainEqual(
      expect.objectContaining({ signal: "file-length", value: 401, threshold: 400 }),
    );

    await sourceFile(root, `${"const line = 1;\n".repeat(399)}`);
    expect(await collectQualityFindings(root)).not.toContainEqual(
      expect.objectContaining({ signal: "file-length" }),
    );
  });

  it("reports generic and multiline object aliases but exempts mapped and other type aliases", async () => {
    const root = await fixtureRoot();
    await sourceFile(
      root,
      `type GenericBox<T> = {};
type MultilineBox = {
  value: string;
};
type GenericMapped<T> = { [K in keyof T]?: T[K] };
type ObjectUnion = { value: string } | null;
type Primitive = string;
type Callback = (value: string) => void;
type Tuple = [string];
`,
    );

    const findings = await collectQualityFindings(root);
    const objectAliases = findings.filter((item) => item.signal === "interface-in-disguise");
    expect(objectAliases).toHaveLength(2);
    expect(objectAliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 1, value: "object type alias" }),
        expect.objectContaining({ line: 2, value: "object type alias" }),
      ]),
    );
    expect(objectAliases).not.toContainEqual(expect.objectContaining({ line: 5 }));
  });

  it("honours a reasoned waiver and reports a reasonless waiver", async () => {
    const root = await fixtureRoot();
    await sourceFile(
      root,
      `// quality-allow: fixture intentionally exceeds the notice line\n${"const line = 1;\n".repeat(401)}`,
    );
    await updateQualityBaseline(root);
    await expect(runQuality(root)).resolves.toContainEqual(
      expect.objectContaining({ signal: "file-length", state: "waived" }),
    );

    await sourceFile(root, `// quality-allow:\n${"const line = 1;\n".repeat(401)}`);
    const findings = await collectQualityFindings(root);
    expect(findings).toContainEqual(
      expect.objectContaining({ signal: "waiver-without-reason", value: "" }),
    );
  });

  it("keeps a stale waiver actionable instead of waiving its own finding", async () => {
    const root = await fixtureRoot();
    await sourceFile(root, "// quality-allow: the old finding was removed\nconst ready = true;\n");
    const baselinePath = path.join(root, "docs", "verification");
    await mkdir(baselinePath, { recursive: true });
    await writeFile(
      path.join(baselinePath, "quality-baseline.json"),
      JSON.stringify({ version: 1, generatedAt: "2026-08-11", counts: {}, findings: [] }),
    );

    const findings = await runQuality(root);
    expect(findings).toContainEqual(
      expect.objectContaining({ signal: "stale-waiver", state: "new" }),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({ signal: "stale-waiver", state: "waived" }),
    );
  });

  it("fails closed when the baseline is missing or malformed", async () => {
    const root = await fixtureRoot();
    await sourceFile(root, "const ready = true;\n");
    await expect(loadQualityBaseline(root)).rejects.toThrow(/baseline missing/u);

    const baselinePath = path.join(root, "docs", "verification");
    await mkdir(baselinePath, { recursive: true });
    await writeFile(path.join(baselinePath, "quality-baseline.json"), "not json");
    await expect(loadQualityBaseline(root)).rejects.toThrow(/malformed quality baseline/iu);

    await writeFile(
      path.join(baselinePath, "quality-baseline.json"),
      JSON.stringify({ version: 1, generatedAt: "2026-08-11", counts: {}, findings: [{}] }),
    );
    await expect(loadQualityBaseline(root)).rejects.toThrow(/every finding needs/u);

    await writeFile(
      path.join(baselinePath, "quality-baseline.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-08-11",
        counts: { "file-length": 2 },
        findings: [
          {
            file: "packages/core/src/fixture.ts",
            line: 1,
            signal: "file-length",
            value: 401,
            threshold: 400,
          },
        ],
      }),
    );
    await expect(loadQualityBaseline(root)).rejects.toThrow(/counts must match findings/u);
  });

  it("writes a baseline whose counts describe its findings", async () => {
    const root = await fixtureRoot();
    await sourceFile(root, `${"const line = 1;\n".repeat(401)}`);
    const baseline = await updateQualityBaseline(root);
    const onDisk = JSON.parse(
      await readFile(path.join(root, "docs", "verification", "quality-baseline.json"), "utf8"),
    ) as { counts: Record<string, number>; findings: { signal: string }[] };
    expect(onDisk.findings).toHaveLength(baseline.findings.length);
    expect(onDisk.counts["file-length"]).toBe(1);
  });

  it("regenerates suppression thresholds without stale values", async () => {
    const root = await fixtureRoot();
    await sourceFile(
      root,
      `const value = input as unknown as string;
// biome-ignore lint/suspicious/noExplicitAny
const ignored: any = value;
`,
    );

    const baseline = await updateQualityBaseline(root);
    const suppressionFindings = baseline.findings.filter((item) =>
      item.signal.startsWith("suppression/"),
    );
    expect(suppressionFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "suppression/unknown-cast", threshold: 10 }),
        expect.objectContaining({ signal: "suppression/biome-ignore", threshold: 1 }),
      ]),
    );
    expect(suppressionFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threshold: 14 }),
        expect.objectContaining({ threshold: 2 }),
      ]),
    );
  });
});
