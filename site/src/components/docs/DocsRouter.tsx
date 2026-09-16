import { Benchmarks } from "./Benchmarks.js";
import { Comparison } from "./Comparison.js";
import { CoreConcepts } from "./CoreConcepts.js";
import { DocsHome } from "./DocsHome.js";
import { GettingStarted } from "./GettingStarted.js";
import { NativeRuntime } from "./NativeRuntime.js";
import { Physics } from "./Physics.js";
import { Playtesting } from "./Playtesting.js";

export function DocsRouter({ path }: { readonly path: string }) {
  if (path === "/docs") return <DocsHome />;
  if (path === "/docs/getting-started") return <GettingStarted />;
  if (path === "/docs/core-concepts") return <CoreConcepts />;
  if (path === "/docs/physics") return <Physics />;
  if (path === "/docs/playtesting") return <Playtesting />;
  if (path === "/docs/native-runtime") return <NativeRuntime />;
  if (path === "/docs/comparison") return <Comparison />;
  if (path === "/docs/benchmarks") return <Benchmarks />;
  throw new Error(`TN_SITE_DOCS_RENDER: no docs component registered for ${path}.`);
}
