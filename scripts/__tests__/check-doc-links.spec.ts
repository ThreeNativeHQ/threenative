import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDocLinks, checkDocLinks } from "../check-doc-links.js";

const temporaryRoots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = makeTempDirSync("check-doc-links-");
  temporaryRoots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    const absoluteFile = join(root, file);
    const parent = dirname(absoluteFile);
    if (parent !== root) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(absoluteFile, contents);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("check-doc-links", () => {
  it("passes a relative link to a real file", () => {
    const root = fixture({
      "docs/README.md": "[guide](guide.md#start)\n",
      "docs/guide.md": "# Start\n",
    });

    expect(assertDocLinks(root, ["docs/README.md"])).toMatchObject({
      filesChecked: 1,
      linksChecked: 1,
      missing: [],
    });
  });

  it("fails with the offending path for a broken link", () => {
    const root = fixture({ "docs/README.md": "[missing](not-here.md)\n" });

    expect(() => assertDocLinks(root, ["docs/README.md"])).toThrow("docs/README.md -> not-here.md");
  });

  it("allows anchor-only and HTTP links without a network call", () => {
    const root = fixture({
      "README.md": "[section](#intro) [site](https://example.invalid/no-network)\n",
    });

    expect(assertDocLinks(root, ["README.md"]).missing).toEqual([]);
  });

  it("strips fenced code before extracting links", () => {
    const root = fixture({
      "README.md": ["```sh", "echo '[missing](not-here.md)'", "```", "[guide](guide.md)", ""].join(
        "\n",
      ),
      "guide.md": "# Guide\n",
    });

    expect(assertDocLinks(root, ["README.md"]).linksChecked).toBe(1);
  });

  it("strips nested fenced examples without treating them as links", () => {
    const root = fixture({
      "README.md": ["```md", "```ts", "[missing](not-here.md)", "```", "```"].join("\n"),
    });

    expect(assertDocLinks(root, ["README.md"]).linksChecked).toBe(0);
  });

  it("blanks inline code spans, which is how prose about links stops being read as one", () => {
    const root = fixture({
      "README.md": [
        "A shell snippet inside fences can contain `](` — this very document does.",
        "Multi-backtick spans hold it too: ``a `](` b``.",
        "[guide](guide.md)",
        "",
      ].join("\n"),
      "guide.md": "# Guide\n",
    });

    expect(assertDocLinks(root, ["README.md"]).linksChecked).toBe(1);
  });

  it("still fails on a broken link outside any code span", () => {
    const root = fixture({
      "README.md": "Prose about `](` and then [missing](not-here.md)\n",
    });

    expect(() => assertDocLinks(root, ["README.md"])).toThrow("README.md -> not-here.md");
  });

  it("leaves an unclosed backtick run alone instead of swallowing the rest of the file", () => {
    const root = fixture({
      "README.md": "An unclosed ` backtick, then [missing](not-here.md)\n",
    });

    expect(() => assertDocLinks(root, ["README.md"])).toThrow("README.md -> not-here.md");
  });

  it("strips tilde fences and inline code spans but fails for malformed prose", () => {
    const root = fixture({
      "README.md": [
        "~~~md",
        "[tilde](missing-tilde.md)",
        "~~~",
        "`[inline](missing-inline.md)`",
        "[guide](guide.md)",
        "",
      ].join("\n"),
      "guide.md": "# Guide\n",
    });

    expect(assertDocLinks(root, ["README.md"]).linksChecked).toBe(1);

    writeFileSync(join(root, "README.md"), "~~~\n[ignored](missing.md)\n~~~\n[broken](\n");
    expect(() => assertDocLinks(root, ["README.md"])).toThrow("Malformed Markdown link");
  });

  it("fails closed for an unterminated or empty link target", () => {
    const root = fixture({ "README.md": "[missing](\n" });
    expect(() => assertDocLinks(root, ["README.md"])).toThrow("Malformed Markdown link");

    writeFileSync(join(root, "README.md"), "[empty]()\n");
    expect(() => checkDocLinks(root, ["README.md"])).toThrow("empty target");
  });

  it("checks links wrapped in escaped backticks as prose", () => {
    const root = fixture({ "README.md": "\\`[missing](not-here.md)\\`\n" });

    expect(() => assertDocLinks(root, ["README.md"])).toThrow("README.md -> not-here.md");
  });

  it("treats backslashes literally while finding an inline code closing run", () => {
    const root = fixture({ "README.md": "`[missing](not-here.md)\\`\n" });

    expect(assertDocLinks(root, ["README.md"])).toMatchObject({ linksChecked: 0, missing: [] });
  });
});
