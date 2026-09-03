import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installCommand, snippet, snippets } from "../src/lib/snippets.js";
import { REPO_ROOT, prerenderedPage } from "./support.js";

describe("the code samples are files, not pictures of files", () => {
  it("should render exactly the bytes of the snippet file", async () => {
    expect(snippets.length).toBe(3);
    for (const item of snippets) {
      // The resolved path is asserted too, so the test cannot pass by comparing a string to
      // itself: the bytes must come from a file under content/snippets/.
      expect(item.path.startsWith("site/src/content/snippets/")).toBe(true);
      const onDisk = await readFile(path.join(REPO_ROOT, item.path), "utf8");
      expect(item.source, `${item.path} is not what the panel renders`).toBe(onDisk);
    }
  });

  it("should render the install command from the file create-threenative documents", async () => {
    const file = await readFile(
      path.join(REPO_ROOT, "site", "src", "content", "snippets", "hero-cli.sh"),
      "utf8",
    );
    expect(installCommand("pnpm")).toBe(file.trimEnd());
    expect(installCommand("pnpm")).toContain("create threenative");

    const scaffolder = JSON.parse(
      await readFile(
        path.join(REPO_ROOT, "packages", "create-threenative", "package.json"),
        "utf8",
      ),
    ) as { readonly name?: string };
    // `pnpm create threenative` resolves to exactly this package; if it is ever renamed, the
    // command on the homepage stops working and this assertion is what says so.
    expect(scaffolder.name).toBe("create-threenative");
    expect(`create-${installCommand("pnpm").split("\n")[0]?.split(" ")[2] ?? ""}`).toBe(
      scaffolder.name,
    );
  });

  it("should rewrite the install command for every package manager it offers", () => {
    expect(installCommand("npm").startsWith("npm create threenative")).toBe(true);
    expect(installCommand("yarn").startsWith("yarn create threenative")).toBe(true);
    expect(installCommand("bun").startsWith("bun create threenative")).toBe(true);
    expect(installCommand("npm")).toContain("npm install");
  });

  it("should ship the TypeScript sample in the prerendered HTML", async () => {
    const page = await prerenderedPage("/");
    expect(page).toContain("defineGame");
    expect(page).toContain("@threenative/core");
    expect(snippet("typescript").source).toContain("defineGame");
  });
});
