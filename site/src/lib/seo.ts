import type { IRoute } from "../routes.js";

export const SITE_ORIGIN = "https://threenative.dev";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function canonicalUrl(route: IRoute): string {
  return route.path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route.path}`;
}

/** The `<head>` for one route, injected by `scripts/prerender.ts` into `index.html`. */
export function headTags(route: IRoute): string {
  const url = canonicalUrl(route);
  const tags = [
    `<title>${escapeAttribute(route.title)}</title>`,
    `<meta name="description" content="${escapeAttribute(route.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    route.indexable
      ? `<meta name="robots" content="index, follow" />`
      : `<meta name="robots" content="noindex, follow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ThreeNative" />`,
    `<meta property="og:title" content="${escapeAttribute(route.title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(route.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE_ORIGIN}${route.ogImage}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttribute(route.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(route.description)}" />`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}${route.ogImage}" />`,
    `<meta name="theme-color" content="#020407" />`,
  ];
  return tags.join("\n    ");
}
