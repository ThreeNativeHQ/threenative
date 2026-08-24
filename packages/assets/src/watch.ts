import { type FSWatcher, watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ASSET_MANIFEST_NAME,
  DEFAULT_ASSET_OUTPUT,
  DEFAULT_ASSET_SOURCE,
  messageOf,
} from "./asset-utils.js";
import {
  type IAssetCompileOptions,
  type IBasisTranscoder,
  compileAssets,
  resolveBasisTranscoder,
} from "./compile.js";

/**
 * Dev-mode compilation: watches the asset source directory and recompiles changed inputs into
 * the output directory, so the dev loop is not "rebuild to see a texture".
 *
 * Watcher mechanism: `node:fs.watch({ recursive: true })` — deliberately neither chokidar nor
 * Vite's own server watcher. This package is Node-only with zero runtime dependencies; Vite's
 * watcher exists only inside a Vite process and would drag in a peer dependency, and chokidar
 * adds a package outright. Recursive `fs.watch` covers Windows, macOS and Linux on the Node
 * versions Vite already requires, keeps `watchAssets` usable outside a dev server, and leaves
 * the template plugin a handful of lines that only start and stop this watcher.
 */

export interface IAssetWatchSummary {
  readonly compiled: readonly string[];
  readonly failed: readonly string[];
}

export interface IAssetWatchOptions extends IAssetCompileOptions {
  /** Quiet window that coalesces a burst of saves into one recompile. Default 100 ms. */
  readonly debounceMs?: number;
  /** Called once per settled burst with the logical paths that compiled and that failed. */
  readonly onChange?: (summary: IAssetWatchSummary) => void;
}

export interface IAssetWatchHandle {
  /**
   * Settles once the initial full compile finished. An initial failure is logged to stderr
   * instead of thrown — a broken asset must not keep a dev server from booting, fixing the file
   * triggers a healing burst, and the build lane still fails closed through `compileAssets`.
   */
  readonly ready: Promise<void>;
  /** Stops watching and cancels any pending debounced burst. Idempotent. */
  close(): void;
}

interface IWatchLayout {
  readonly manifestPath: string;
  readonly outputRoot: string;
  readonly sourceRoot: string;
}

interface IManifestFile {
  readonly entries: Record<string, unknown>;
  readonly raw: string | undefined;
}

interface ICompiledEntry {
  readonly output: string;
}

const DEFAULT_DEBOUNCE_MS = 100;

function resolveWatchLayout(cwd: string, options: IAssetWatchOptions): IWatchLayout {
  const source = options.source ?? options.config?.source ?? DEFAULT_ASSET_SOURCE;
  const output = options.output ?? options.config?.output ?? DEFAULT_ASSET_OUTPUT;
  const sourceRoot = path.resolve(cwd, source);
  const outputRoot = path.resolve(cwd, output);
  return { manifestPath: path.join(outputRoot, ASSET_MANIFEST_NAME), outputRoot, sourceRoot };
}

function readManifest(manifestPath: string): Promise<IManifestFile> {
  const fail = (reason: string): Error =>
    new Error(`TN_ASSETS_MANIFEST_INVALID: '${manifestPath}' ${reason}.`);
  return readFile(manifestPath, "utf8").then(
    (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw fail("is not valid JSON");
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as { version?: unknown }).version !== 1 ||
        typeof (parsed as { entries?: unknown }).entries !== "object" ||
        (parsed as { entries: unknown }).entries === null ||
        Array.isArray((parsed as { entries: unknown }).entries)
      ) {
        throw fail("must hold version 1 entries");
      }
      return { entries: (parsed as { entries: Record<string, unknown> }).entries, raw };
    },
    () => ({ entries: {}, raw: undefined }),
  );
}

/** Temp file + rename: a crash mid-write must never leave a truncated manifest behind. */
async function writeManifestAtomically(
  manifestPath: string,
  entries: Record<string, unknown>,
  raw: string | undefined,
): Promise<void> {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(entries).sort()) ordered[key] = entries[key];
  const serialized = `${JSON.stringify({ version: 1, entries: ordered }, null, 2)}\n`;
  if (serialized === raw) return;
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, manifestPath);
}

/**
 * Compiles exactly one input by running `compileAssets` inside a scratch directory holding only
 * that file, then copying the hashed output out. Delegating keeps hashing, classification and
 * pass semantics in one place, so a dev save can never produce names the build would not.
 */
async function recompileOne(
  layout: IWatchLayout,
  compileOptions: {
    readonly config?: IAssetCompileOptions["config"];
    readonly output?: string;
    readonly passes?: IAssetCompileOptions["passes"];
    readonly source?: string;
    readonly transcoder?: IBasisTranscoder;
  },
  logical: string,
): Promise<ICompiledEntry> {
  const scratch = await mkdtemp(path.join(tmpdir(), "threenative-watch-"));
  try {
    const stagedInput = path.join(scratch, DEFAULT_ASSET_SOURCE, logical);
    await mkdir(path.dirname(stagedInput), { recursive: true });
    await writeFile(stagedInput, await readFile(path.join(layout.sourceRoot, logical)));
    // The scratch directory has no node_modules of its own; the resolved options carry the
    // project's transcoder paths so a single-texture save produces exactly what a build
    // would — including the Basis runtime files the KTX2 loader fetches. cwd/output/source
    // stay the scratch lane's own: the resolved options must never override them.
    await compileAssets({
      cwd: scratch,
      output: "out",
      source: DEFAULT_ASSET_SOURCE,
      ...(compileOptions.config === undefined ? {} : { config: compileOptions.config }),
      ...(compileOptions.passes === undefined ? {} : { passes: compileOptions.passes }),
      ...(compileOptions.transcoder === undefined ? {} : { transcoder: compileOptions.transcoder }),
    });
    const scratchManifest = JSON.parse(
      await readFile(path.join(scratch, "out", ASSET_MANIFEST_NAME), "utf8"),
    ) as { entries: Record<string, ICompiledEntry | undefined> };
    const entry = scratchManifest.entries[logical];
    if (entry === undefined || entry.output === undefined) {
      throw new Error("compiled without producing a manifest entry");
    }
    const destination = path.join(layout.outputRoot, entry.output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(scratch, "out", entry.output)));
    return entry;
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

export function watchAssets(options: IAssetWatchOptions = {}): IAssetWatchHandle {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const layout = resolveWatchLayout(cwd, options);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  // Resolved once against the project root: the scratch compiles have no node_modules of
  // their own. A project where three cannot be resolved keeps its dev server alive and sees
  // the named per-file failure instead.
  const transcoder =
    options.transcoder ??
    (() => {
      try {
        return resolveBasisTranscoder(cwd);
      } catch {
        return undefined;
      }
    })();
  const compileOptions = {
    config: options.config,
    cwd,
    output: options.output,
    passes: options.passes,
    source: options.source,
    ...(transcoder === undefined ? {} : { transcoder }),
  };
  const logFailure = (message: string): void => {
    process.stderr.write(`TN_ASSETS_WATCH_FAILED: ${message}\n`);
  };

  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> = Promise.resolve();
  let fullReconcileQueued = false;
  let closed = false;
  const queue = new Set<string>();

  const armDebounce = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runFlush();
    }, debounceMs);
  };

  const queueFullReconcile = (): void => {
    // A vanished file or an unnamed event cannot be handled per input: rebuild everything
    // through the one canonical compiler instead of guessing deletions per manifest entry.
    fullReconcileQueued = true;
    armDebounce();
  };

  const queueEvent = (filename: string): void => {
    const logical = filename.split(path.sep).join("/").replace(/^\.\//u, "");
    if (logical.length === 0 || logical.split("/").some((segment) => segment.startsWith("."))) {
      return;
    }
    void stat(path.join(layout.sourceRoot, logical)).then(
      (info) => {
        if (!info.isFile()) return; // directories announce their children separately
        queue.add(logical);
        armDebounce();
      },
      () => {
        queue.delete(logical);
        queueFullReconcile();
      },
    );
  };

  const fullRebuild = async (): Promise<void> => {
    try {
      await compileAssets(compileOptions);
    } catch (error) {
      logFailure(`full reconcile failed: ${messageOf(error)}`);
    }
  };

  /** Merges this burst's successful entries and writes the manifest temp-then-rename. */
  const mergeEntries = async (merged: ReadonlyMap<string, ICompiledEntry>): Promise<void> => {
    if (merged.size === 0) return;
    try {
      const current = await readManifest(layout.manifestPath);
      for (const [logical, entry] of merged) current.entries[logical] = entry;
      await writeManifestAtomically(layout.manifestPath, current.entries, current.raw);
    } catch (error) {
      logFailure(`manifest update deferred: ${messageOf(error)}`);
    }
  };

  const reportBurst = (compiled: readonly string[], failed: readonly string[]): void => {
    if (options.onChange === undefined || (compiled.length === 0 && failed.length === 0)) return;
    try {
      options.onChange({ compiled, failed });
    } catch (error) {
      logFailure(`onChange listener threw: ${messageOf(error)}`);
    }
  };

  const flush = async (batch: readonly string[], reconcileAll: boolean): Promise<void> => {
    if (reconcileAll) await fullRebuild();
    const compiled: string[] = [];
    const failed: string[] = [];
    const merged = new Map<string, ICompiledEntry>();
    for (const logical of batch) {
      try {
        merged.set(logical, await recompileOne(layout, compileOptions, logical));
        compiled.push(logical);
      } catch (error) {
        // The previous output (content-addressed, never overwritten) and previous manifest
        // entry stay untouched; the path is reported and the next good save heals it.
        failed.push(logical);
        logFailure(`could not recompile '${logical}': ${messageOf(error)}`);
      }
    }
    await mergeEntries(merged);
    reportBurst(compiled, failed);
  };

  const runFlush = (): void => {
    const batch = [...queue].sort();
    queue.clear();
    const reconcileAll = fullReconcileQueued;
    fullReconcileQueued = false;
    flushing = flushing.then(async () => {
      if (!closed) {
        try {
          await flush(batch, reconcileAll);
        } catch (error) {
          logFailure(`burst failed: ${messageOf(error)}`);
        }
      }
    });
  };

  const startWatching = (): void => {
    try {
      watcher = watch(layout.sourceRoot, { recursive: true }, (_eventType, filename) => {
        if (closed) return;
        if (typeof filename !== "string" || filename.length === 0) {
          queueFullReconcile();
          return;
        }
        queueEvent(filename);
      });
    } catch {
      // No assets/ directory yet is the documented pre-pipeline state: stay inert until restart.
      return;
    }
    watcher.on("error", (error) => {
      logFailure(messageOf(error));
      queueFullReconcile();
    });
  };

  const ready = (async () => {
    try {
      await compileAssets(compileOptions);
    } catch (error) {
      logFailure(`initial compile failed: ${messageOf(error)}`);
    }
    if (!closed) startWatching();
  })();

  return {
    ready,
    close: () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      watcher?.close();
      watcher = undefined;
    },
  };
}
