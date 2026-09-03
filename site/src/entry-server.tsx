import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./app.js";
import { headTags } from "./lib/seo.js";
import { type IRoute, routes } from "./routes.js";

export interface IPrerendered {
  readonly head: string;
  readonly html: string;
  readonly route: IRoute;
}

/** Called by `scripts/prerender.ts` once per route. Throws rather than emitting an empty body. */
export function render(path: string): IPrerendered {
  const route = routes.find((candidate) => candidate.path === path);
  if (route === undefined) throw new Error(`TN_SITE_PRERENDER_NO_ROUTE: ${path}`);
  const html = renderToString(
    <StrictMode>
      <App route={route} />
    </StrictMode>,
  );
  return { head: headTags(route), html, route };
}

export { routes };
