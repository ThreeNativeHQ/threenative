import { Benchmarks } from "./Benchmarks.js";
import { Comparison } from "./Comparison.js";
import { DocsHome } from "./DocsHome.js";
import { GettingStarted } from "./GettingStarted.js";

export function DocsRouter({ path }: { readonly path: string }) {
  if (path === "/docs") return <DocsHome />;
  if (path === "/docs/getting-started") return <GettingStarted />;
  if (path === "/docs/comparison") return <Comparison />;
  if (path === "/docs/benchmarks") return <Benchmarks />;
  throw new Error(`TN_SITE_DOCS_RENDER: no docs component registered for ${path}.`);
}
