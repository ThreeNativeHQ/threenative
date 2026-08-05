import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeSandbox, readManifest, resolveGenre } from "../make-sandbox";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

describe("genre sandbox", () => {
  it("writes a manifest with the genre and sealed brief hash", async () => {
    const root = await temporaryRoot("threenative-sandbox-");
    const result = makeSandbox({
      bare: true,
      genre: "platformer",
      out: path.join(root, "sandbox"),
      prepare: false,
      repo: process.cwd(),
      template: "platformer",
    });
    const manifest = readManifest(path.join(result.out, "sweep.json"));
    const brief = await readFile(path.join(result.out, "brief.md"));
    const scaffold = await readFile(path.join(result.out, "scaffold.sh"), "utf8");
    expect(manifest).toMatchObject({ genre: "platformer", template: "platformer" });
    expect(manifest.briefHash).toBe(createHash("sha256").update(brief).digest("hex"));
    expect(scaffold).toContain('cp sweep.json "${1:-game}/sweep.json"');
    await expect(readFile(path.join(result.out, "reference.png"))).resolves.toEqual(
      await readFile("docs/benchmark/genres/platformer/reference.png"),
    );
  }, 30_000);

  it("throws before creating a sandbox when the genre brief is missing", async () => {
    const root = await temporaryRoot("threenative-genre-");
    const genre = path.join(root, "docs", "benchmark", "genres", "missing");
    await mkdir(genre, { recursive: true });
    await writeFile(path.join(genre, "reference.png"), "reference");
    expect(() => resolveGenre(root, "missing")).toThrow(/missing its required brief/);
    await expect(readFile(path.join(root, "sandbox", "sweep.json"))).rejects.toThrow();
  });

  it("throws when the genre reference image is missing", async () => {
    const root = await temporaryRoot("threenative-genre-");
    const genre = path.join(root, "docs", "benchmark", "genres", "missing");
    await mkdir(genre, { recursive: true });
    await writeFile(path.join(genre, "brief.md"), "sealed brief\n");
    expect(() => resolveGenre(root, "missing")).toThrow(/missing its required reference image/);
  });

  it("refuses to wipe a sandbox whose manifest is not archived", async () => {
    const root = await temporaryRoot("threenative-guard-");
    const sandbox = path.join(root, "sandbox");
    const brief = await readFile("docs/benchmark/genres/platformer/brief.md");
    await mkdir(sandbox, { recursive: true });
    await writeFile(path.join(sandbox, "sentinel.txt"), "keep me\n");
    await writeFile(
      path.join(sandbox, "sweep.json"),
      JSON.stringify({
        genre: "platformer",
        briefHash: createHash("sha256").update(brief).digest("hex"),
        template: "platformer",
        date: "2099-01-01T00:00:00.000Z",
        frameworkVersion: "0.1.0",
        sourceLines: 0,
      }),
    );
    expect(() =>
      makeSandbox({
        genre: "platformer",
        out: sandbox,
        repo: process.cwd(),
        template: "platformer",
      }),
    ).toThrow(/pnpm sweep:archive/);
    await expect(readFile(path.join(sandbox, "sentinel.txt"), "utf8")).resolves.toBe("keep me\n");
  });
});
