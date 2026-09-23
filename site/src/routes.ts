/**
 * The one route table. `app.tsx` renders from it, `scripts/prerender.ts` builds from it, the
 * header and footer navigate from it, and the sitemap is emitted from it. A page that is not
 * here does not exist, and a page here that renders nothing fails the build.
 */
export interface IRoute {
  /** Absolute site path, always leading-slash and never trailing-slash except the root. */
  readonly path: string;
  /** Short label for navigation and breadcrumbs. */
  readonly label: string;
  /** `<title>` for the route. Unique across the table. */
  readonly title: string;
  /** `<meta name="description">`. Unique across the table, never empty. */
  readonly description: string;
  /** Open Graph image path, served from `public/`. */
  readonly ogImage: string;
  /** Whether the route belongs in `sitemap.xml` and may be indexed. */
  readonly indexable: boolean;
}

export const routes: readonly IRoute[] = [
  {
    path: "/",
    label: "Home",
    title: "ThreeNative — build native 3D apps with the Three.js API",
    description:
      "ThreeNative lets you write familiar Three.js code and ship high-performance experiences across web, desktop, and mobile — without WebView overhead.",
    ogImage: "/og/home.svg",
    indexable: true,
  },
  {
    path: "/404",
    label: "Page not found",
    title: "Page not found — ThreeNative",
    description: "That page is not part of the ThreeNative site. Start from the home page instead.",
    ogImage: "/og/home.svg",
    indexable: false,
  },
];

export function findRoute(path: string): IRoute | undefined {
  const normalised = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return routes.find((route) => route.path === normalised);
}

export function routePaths(): readonly string[] {
  return routes.map((route) => route.path);
}
