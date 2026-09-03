import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IPrerendered } from "../src/entry-server.js";
import { SITE_ORIGIN, canonicalUrl } from "../src/lib/seo.js";
import type { IRoute } from "../src/routes.js";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = path.join(SITE_ROOT, "dist", "client");
const SERVER_ENTRY = path.join(SITE_ROOT, "dist", "server", "entry-server.js");
const HEAD_MARKER = "<!--app-head-->";
const HTML_MARKER = '<div id="root"><!--app-html--></div>';
/** A shell with a hero in it is far larger than this; the floor only catches an empty render. */
const MINIMUM_BODY_BYTES = 2000;

interface IServerEntry {
  readonly render: (routePath: string) => IPrerendered;
  readonly routes: readonly IRoute[];
}

function outputFile(routePath: string): string {
  return routePath === "/"
    ? path.join(CLIENT_DIR, "index.html")
    : path.join(CLIENT_DIR, routePath.replace(/^\//u, ""), "index.html");
}

function assertRenderable(routePath: string, rendered: IPrerendered): void {
  const body = rendered.html.trim();
  if (body.length < MINIMUM_BODY_BYTES) {
    throw new Error(
      `TN_SITE_PRERENDER_EMPTY: ${routePath} rendered ${body.length} bytes, below ${MINIMUM_BODY_BYTES}.`,
    );
  }
  if (!body.includes("<h1")) {
    throw new Error(`TN_SITE_PRERENDER_NO_H1: ${routePath} rendered no <h1> element.`);
  }
  if (!rendered.head.includes("<title>")) {
    throw new Error(`TN_SITE_PRERENDER_NO_TITLE: ${routePath} rendered no <title>.`);
  }
}

function sitemap(routes: readonly IRoute[]): string {
  const entries = routes
    .filter((route) => route.indexable)
    .map((route) => `  <url>\n    <loc>${canonicalUrl(route)}</loc>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function robots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

async function main(): Promise<void> {
  const template = await readFile(path.join(CLIENT_DIR, "index.html"), "utf8");
  if (!template.includes(HEAD_MARKER) || !template.includes(HTML_MARKER)) {
    throw new Error(
      "TN_SITE_PRERENDER_TEMPLATE: dist/client/index.html lost its <!--app-head--> or <!--app-html--> marker.",
    );
  }

  const entry = (await import(SERVER_ENTRY)) as IServerEntry;
  if (entry.routes.length === 0)
    throw new Error("TN_SITE_PRERENDER_NO_ROUTES: routes.ts is empty.");

  const written: string[] = [];
  for (const route of entry.routes) {
    const rendered = entry.render(route.path);
    assertRenderable(route.path, rendered);
    const page = template
      .replace(HEAD_MARKER, rendered.head)
      .replace(HTML_MARKER, `<div id="root">${rendered.html}</div>`);
    const file = outputFile(route.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, page, "utf8");
    written.push(path.relative(SITE_ROOT, file));
    // Cloudflare's `not_found_handling: "404-page"` serves `404.html`, not `/404/index.html`.
    if (route.path === "/404") {
      const alias = path.join(CLIENT_DIR, "404.html");
      await writeFile(alias, page, "utf8");
      written.push(path.relative(SITE_ROOT, alias));
    }
  }

  await writeFile(path.join(CLIENT_DIR, "sitemap.xml"), sitemap(entry.routes), "utf8");
  await writeFile(path.join(CLIENT_DIR, "robots.txt"), robots(), "utf8");
  process.stdout.write(`prerendered ${written.length} files:\n  ${written.join("\n  ")}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
