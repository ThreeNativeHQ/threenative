import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claimText } from "../src/content/claims.js";
import { canonicalUrl } from "../src/lib/seo.js";
import { routes } from "../src/routes.js";
import { CLIENT_DIR, prerenderedPage } from "./support.js";

describe("the prerendered site", () => {
  it("should prerender every route to non-empty HTML with a title and an h1", async () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const page = await prerenderedPage(route.path);
      expect(page, `${route.path} has no <h1>`).toContain("<h1");
      expect(page, `${route.path} kept the empty shell`).not.toContain('<div id="root"></div>');
      expect(page, `${route.path} has the wrong title`).toContain(`<title>${route.title}</title>`);
      expect(page.length, `${route.path} is suspiciously small`).toBeGreaterThan(4000);
    }
  });

  it("should ship the hero headline and subhead in prerendered HTML", async () => {
    const page = await prerenderedPage("/");
    expect(page).toContain(claimText("hero-headline"));
    expect(page).toContain("without WebView overhead");
  });

  it("should give every route a unique title, description and canonical", async () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    const canonicals = new Set<string>();
    for (const route of routes) {
      expect(route.title.length, `${route.path} has an empty title`).toBeGreaterThan(0);
      expect(route.description.length, `${route.path} has an empty description`).toBeGreaterThan(0);
      titles.add(route.title);
      descriptions.add(route.description);
      canonicals.add(canonicalUrl(route));
      const page = await prerenderedPage(route.path);
      expect(page).toContain(`<link rel="canonical" href="${canonicalUrl(route)}" />`);
      expect(page).toContain(route.description);
    }
    expect(titles.size).toBe(routes.length);
    expect(descriptions.size).toBe(routes.length);
    expect(canonicals.size).toBe(routes.length);
  });

  it("should list every indexable route in sitemap.xml and no other", async () => {
    const sitemap = await readFile(path.join(CLIENT_DIR, "sitemap.xml"), "utf8");
    const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((m) => m[1] ?? ""));
    const expected = new Set(routes.filter((r) => r.indexable).map((r) => canonicalUrl(r)));
    expect(listed).toEqual(expected);
    for (const route of routes.filter((r) => !r.indexable)) {
      expect(listed.has(canonicalUrl(route))).toBe(false);
    }
  });

  it("should serve a 404 page at the path Cloudflare asks for", async () => {
    const alias = await readFile(path.join(CLIENT_DIR, "404.html"), "utf8");
    expect(alias).toContain('content="noindex, follow"');
    expect(alias).toContain("Page not found");
  });
});
