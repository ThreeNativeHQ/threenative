import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createWebBrandPlugin } from "../src/web-brand.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("web branding adapter", () => {
  it("uses config identity for HTML metadata and the emitted manifest", async () => {
    const root = await makeTempDir("threenative-web-brand-");
    roots.push(root);
    await mkdir(path.join(root, "public"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "brand-game", type: "module" }),
    );
    await writeFile(
      path.join(root, "public/icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" />\n',
    );
    await writeFile(
      path.join(root, "threenative.config.ts"),
      `export default {
        app: { name: "Branded Quest", icons: { web: { favicon: "public/icon.svg" } } },
        bootSplash: { backgroundColor: "#123456" },
      };\n`,
    );
    const plugin = createWebBrandPlugin();
    await plugin.configResolved({ root });
    const html =
      plugin.transformIndexHtml(`<!doctype html><html><head><title>old</title></head><body>
      <div data-threenative-launch><span data-threenative-launch-name>old</span></div>
    </body></html>`);
    expect(html).toContain("<title>Branded Quest</title>");
    expect(html).toContain('rel="icon" href="/icon.svg"');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain("data-threenative-launch-name>Branded Quest");

    let emitted = "";
    plugin.generateBundle.call({
      emitFile: ({ source }: { source: string }) => {
        emitted = source;
      },
    });
    expect(JSON.parse(emitted)).toMatchObject({
      background_color: "#123456",
      icons: [{ purpose: "any", src: "/icon.svg", type: "image/svg+xml" }],
      name: "Branded Quest",
      theme_color: "#123456",
    });
  });
});
