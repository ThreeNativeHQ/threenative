import { type Hash, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * A dev server booted before an engine reinstall serves the old build from memory, and a rebuilt
 * engine tarball keeps its filename — so a package manager and vite's dep cache both see
 * "nothing changed". The 2026-08-27 disappearing-walls report was exactly this: a fix had
 * landed, the server predated it, and the stale build read as an engine regression. This plugin
 * hashes the installed `@threenative/*` dist trees at boot, forces vite to re-bundle its
 * optimized deps when they changed, and names any still-running server that is serving the
 * older build.
 *
 * It also stops the web build shipping three's decoder libraries as dead assets, described on
 * `rewriteDecoderAssetUrls` below.
 */

/** Shape of `node_modules/.vite/threenative-engine-build.json`, written once the server listens. */
export interface IEngineBuildMarker {
  readonly hash: string;
  readonly pid: number;
  readonly port?: number;
}

export interface IEngineFreshnessVitePlugin {
  readonly name: string;
  config(
    config: { readonly root?: string },
    env: { readonly command: string },
  ): { resolve: { dedupe: string[] }; optimizeDeps?: { force: boolean } };
  configureServer(server: {
    readonly config: { readonly root?: string };
    readonly httpServer?: {
      once(event: string, listener: () => void): unknown;
      address(): { readonly port?: number } | string | null;
    } | null;
  }): void;
  transform(code: string, id: string): { code: string; map: null } | null;
}

/**
 * The two three loader modules whose default decoder URLs Vite copies into `dist/assets`.
 *
 * `@threenative/core` imports them dynamically; `KTX2Loader.js` and `DRACOLoader.js` each hold
 * `new URL('../libs/…', import.meta.url)` literals, which Vite's asset-import-meta-url handling
 * turns into hashed files. Nothing ever fetches them: core calls `setTranscoderPath`/
 * `setDecoderPath` pointing at the compile-copied `basis/` and `draco/` folders instead, so a
 * template web build shipped 1.93 MB of dead decoder files.
 */
const DECODER_LOADER_ID = /[/\\]examples[/\\]jsm[/\\]loaders[/\\](?:KTX2Loader|DRACOLoader)\.js$/u;
const DECODER_LIB_ASSET_URL =
  /new URL\(\s*(['"])\.\.\/libs\/([^'"]+)\1\s*,\s*import\.meta\.url\s*\)(?:\.toString\s*\(\s*\)|\.href\s*)?/gu;

/**
 * Replaces `new URL('../libs/…', import.meta.url).toString()` with a plain relative string, so
 * Vite has no asset URL to emit. The loaders only ever use these as defaults that core always
 * overrides, so the plain string is never resolved.
 */
export function rewriteDecoderAssetUrls(code: string): string {
  return code.replace(DECODER_LIB_ASSET_URL, '"../libs/$2"');
}

const MARKER_RELATIVE = path.join("node_modules", ".vite", "threenative-engine-build.json");

function hashTree(hash: Hash, directory: string): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      hashTree(hash, full);
    } else if (entry.isFile()) {
      hash.update(path.relative(directory, full));
      hash.update(readFileSync(full));
    }
  }
}

/** Content hash of every installed `@threenative/*` package's `dist/`, or null when none is installed. */
export function hashEngineDist(projectRoot: string): string | undefined {
  const scopeDir = path.join(projectRoot, "node_modules", "@threenative");
  let packages: readonly string[];
  try {
    // `entry.isDirectory()` is false for a symlink, and pnpm installs the scope through
    // symlinks into its store — accept both, the realpath below filters non-directories.
    packages = readdirSync(scopeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  } catch {
    return undefined;
  }
  const dists: Array<[string, string]> = [];
  for (const name of packages) {
    let packageDir = path.join(scopeDir, name);
    try {
      packageDir = realpathSync(packageDir); // pnpm installs through symlinks into its store
    } catch {
      continue;
    }
    const dist = path.join(packageDir, "dist");
    if (existsSync(dist)) dists.push([name, dist]);
  }
  if (dists.length === 0) return undefined;
  const hash = createHash("sha256");
  for (const [name, dist] of dists) {
    hash.update(name);
    hashTree(hash, dist);
  }
  return hash.digest("hex");
}

function markerPath(projectRoot: string): string {
  return path.join(projectRoot, MARKER_RELATIVE);
}

function readMarker(file: string): IEngineBuildMarker | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as IEngineBuildMarker;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

export function createEngineFreshnessPlugin(): IEngineFreshnessVitePlugin {
  let recordedHash: string | undefined;
  const rootOf = (config: { readonly root?: string }): string =>
    path.resolve(config.root ?? process.cwd());
  return {
    name: "threenative-engine-freshness",
    config(config, env) {
      // Linked engine packages otherwise resolve their own Three.js shader state and React
      // dispatcher. Vite merges this list with the game's entries, including subpath imports.
      const resolve = { dedupe: ["three", "react", "react-dom"] };
      if (env.command !== "serve") return { resolve };
      const root = rootOf(config);
      recordedHash = hashEngineDist(root);
      const marker = recordedHash === undefined ? undefined : readMarker(markerPath(root));
      if (recordedHash === undefined || marker === undefined || marker.hash === recordedHash) {
        return { resolve };
      }
      if (processIsAlive(marker.pid)) {
        const where =
          marker.port === undefined
            ? `pid ${marker.pid}`
            : `pid ${marker.pid} on port ${marker.port}`;
        const how =
          marker.port === undefined ? "" : ` (lsof -ti tcp:${marker.port} | xargs -r kill)`;
        console.warn(
          `threenative: a dev server is still running at ${where}, serving engine build ` +
            `${marker.hash.slice(0, 8)}; the installed build is ${recordedHash.slice(0, 8)}. ` +
            `Kill it before playing${how} — its tab renders yesterday's engine.`,
        );
      }
      return { resolve, optimizeDeps: { force: true } };
    },
    transform(code, id) {
      if (!DECODER_LOADER_ID.test(id)) return null;
      const rewritten = rewriteDecoderAssetUrls(code);
      return rewritten === code ? null : { code: rewritten, map: null };
    },
    configureServer(server) {
      const root = rootOf(server.config);
      const file = markerPath(root);
      const writeBootMarker = (port: number | undefined): void => {
        const hash = recordedHash ?? hashEngineDist(root);
        if (hash === undefined) return;
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(
          file,
          JSON.stringify(
            port === undefined ? { hash, pid: process.pid } : { hash, pid: process.pid, port },
          ),
        );
      };
      const httpServer = server.httpServer;
      if (httpServer === undefined || httpServer === null) {
        writeBootMarker(undefined); // middleware mode: no port to record
        return;
      }
      httpServer.once("listening", () => {
        const address = httpServer.address();
        writeBootMarker(
          typeof address === "object" && address !== null && address.port !== undefined
            ? address.port
            : undefined,
        );
      });
      httpServer.once("close", () => {
        const marker = readMarker(file);
        if (marker?.pid === process.pid) rmSync(file, { force: true });
      });
    },
  };
}
