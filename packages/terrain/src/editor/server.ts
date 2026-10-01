import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, resolve } from "node:path";
import type { Plugin } from "vite";
import { validatePlacementOverrides } from "../core/placements.js";
import { type PatchCommand, Terrain, TerrainEvaluator } from "../core/terrain.js";
import type { ITerrainDocument } from "../core/types.js";
import type { IPlacementOverride } from "../core/types.js";
import {
  type ICameraResult,
  type ISavedCamera,
  runCameraOperation,
  validateCameras,
} from "./cameras.js";
import {
  type ISpatialObservation,
  type ISpatialQuery,
  inspectSpatial,
  validateSpatialReference,
} from "./spatialInspector.js";

const PREFIX = "/terrain-editor/";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCES = 16;

export interface IAuthoringDocument {
  version: 1;
  recipe: ITerrainDocument;
  placementOverrides?: Record<string, IPlacementOverride>;
  /** Saved reference registrations. Authoring metadata: never evaluated, never exported. */
  references?: ReturnType<typeof validateSpatialReference>[];
  /** Saved editor observation cameras. Authoring metadata: never evaluated, never exported. */
  cameras?: ISavedCamera[];
  /** Which saved camera is live; absent or `null` is the ordinary editor camera. */
  activeCamera?: string | null;
}
export interface IEditorSnapshot {
  revision: string;
  document: IAuthoringDocument;
  diagnostic: string | null;
}
export interface IEditorActivation {
  editorUrl: string;
  projectId: string;
  sessionId: string;
  revision: string;
}

function validate(value: unknown): IAuthoringDocument {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an authoring document");
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    Object.keys(input).some(
      (key) =>
        ![
          "version",
          "recipe",
          "placementOverrides",
          "references",
          "cameras",
          "activeCamera",
        ].includes(key),
    )
  )
    throw new Error("Unsupported authoring document fields/version");
  const recipe = Terrain.fromJSON(input.recipe as ITerrainDocument).toJSON();
  const document: IAuthoringDocument = { version: 1, recipe };
  if (input.placementOverrides !== undefined)
    document.placementOverrides = validatePlacementOverrides(input.placementOverrides);
  if (input.references !== undefined) {
    if (!Array.isArray(input.references) || input.references.length > MAX_REFERENCES)
      throw new Error(`A document holds at most ${MAX_REFERENCES} saved references`);
    document.references = input.references.map((entry) => validateSpatialReference(entry));
  }
  if (input.cameras !== undefined) document.cameras = validateCameras(input.cameras);
  if (input.activeCamera !== undefined) {
    // An active camera that no longer exists is not a stale document: it falls back to the editor camera.
    const active = input.activeCamera;
    if (active !== null) {
      if (
        typeof active !== "string" ||
        !(document.cameras ?? []).some((entry) => entry.id === active)
      )
        throw new Error("activeCamera must name a saved camera");
    }
    document.activeCamera = active;
  }
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_BYTES)
    throw new Error("Authoring document exceeds 64 MiB");
  return document;
}
function revision(document: IAuthoringDocument): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}
class EditorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Project-local terrain document authority; no renderer or game dependency.
 * @requires npm i -D @threenative/terrain
 * @situation validate atomic revision-based project-local terrain document edits
 * @constraint Node authoring only; documentPath is a configured absolute regular file; input is bounded to 64 MiB
 * @example const document = new TerrainEditorDocument("/project/terrain/world.json"); const snapshot = document.snapshot();
 * @override the project chooses its document path; revisions come from validated content
 */
export class TerrainEditorDocument {
  readonly path: string;
  #snapshot: IEditorSnapshot;
  #listeners = new Set<(snapshot: IEditorSnapshot) => void>();
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("Document path must be absolute");
    this.path = resolve(path);
    const document = this.#read();
    this.#snapshot = { document, revision: revision(document), diagnostic: null };
  }
  #read(): IAuthoringDocument {
    const info = lstatSync(this.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES)
      throw new Error("Document must be a regular file of at most 64 MiB");
    return validate(JSON.parse(readFileSync(this.path, "utf8")));
  }
  snapshot(): IEditorSnapshot {
    return structuredClone(this.#snapshot);
  }
  subscribe(listener: (snapshot: IEditorSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(): void {
    for (const listener of this.#listeners) listener(this.snapshot());
  }
  refresh(): void {
    try {
      const document = this.#read();
      const nextRevision = revision(document);
      if (nextRevision === this.#snapshot.revision && this.#snapshot.diagnostic === null) return;
      this.#snapshot = { document, revision: nextRevision, diagnostic: null };
    } catch (error) {
      this.#snapshot.diagnostic = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }
  commit(input: unknown): IEditorSnapshot {
    this.refresh();
    if (this.#snapshot.diagnostic)
      throw new EditorError(409, "Disk document is invalid; restore a valid save before editing");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Expected a transaction");
    const request = input as Record<string, unknown>;
    if (Object.keys(request).some((key) => !["baseRevision", "commands", "document"].includes(key)))
      throw new Error("Unknown transaction fields");
    if (request.baseRevision !== this.#snapshot.revision)
      throw new EditorError(409, "Stale base revision");
    if ((request.commands === undefined) === (request.document === undefined))
      throw new Error("Supply commands or document, exclusively");
    let next: IAuthoringDocument;
    if (request.commands !== undefined) {
      if (
        !Array.isArray(request.commands) ||
        !request.commands.length ||
        request.commands.length > 512
      )
        throw new Error("Expected 1–512 patch commands");
      const terrain = Terrain.fromJSON(this.#snapshot.document.recipe);
      terrain.applyPatch(request.commands as PatchCommand[]);
      next = validate({ ...this.#snapshot.document, recipe: terrain.toJSON() });
    } else next = validate(request.document);
    const nextRevision = revision(next);
    if (nextRevision === this.#snapshot.revision) return this.snapshot();
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    // ponytail: synchronous local transactions serialize HTTP edits; external editors must save atomically.
    // The revision check detects completed external saves, not a non-cooperating writer racing rename.
    try {
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
          throw new AggregateError(
            [error, cleanupError],
            "Document save and temporary-file cleanup failed",
          );
      }
      throw error;
    }
    this.#snapshot = { document: next, revision: nextRevision, diagnostic: null };
    this.#emit();
    return this.snapshot();
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new EditorError(415, "Expected application/json");
  if (Number(request.headers["content-length"]) > MAX_BYTES)
    throw new EditorError(413, "Request exceeds 64 MiB");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BYTES) throw new EditorError(413, "Request exceeds 64 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

/**
 * Mount the optional terrain document API on an existing loopback Vite server.
 * @requires npm i -D @threenative/terrain vite
 * @situation share terrain recipe edits between an agent and the live terrain editor
 * @constraint dev tooling only; serve a project-owned /terrain-editor/index.html; no runtime import
 * @example const editor = terrainEditor({ documentPath: resolve("terrain/world.json") });
 * @override documentPath and optional configured viewerUrl belong to the project
 */
export function terrainEditor(options: { documentPath: string; viewerUrl?: string }): Plugin & {
  activate(): Promise<IEditorActivation>;
} {
  const viewer = options.viewerUrl ? new URL(options.viewerUrl) : undefined;
  if (
    viewer &&
    (!["http:", "https:"].includes(viewer.protocol) ||
      viewer.username ||
      viewer.password ||
      viewer.search ||
      viewer.hash ||
      !viewer.pathname.endsWith(PREFIX))
  )
    throw new Error("Viewer URL must be an explicit HTTP(S) forwarded terrain-editor URL");
  const document = new TerrainEditorDocument(options.documentPath);
  const evaluator = new TerrainEvaluator();
  const projectId = createHash("sha256").update(document.path).digest("hex");
  const sessionId = randomUUID();
  let origin: string | undefined;
  let url: string | undefined;
  const clients = new Set<ServerResponse>();
  const unsubscribe = document.subscribe((snapshot) => {
    for (const response of clients)
      if (!response.write(`data: ${JSON.stringify(snapshot)}\n\n`)) response.end();
  });
  const activation = (): IEditorActivation => {
    if (!origin || !url) throw new EditorError(503, "Editor server is not listening");
    return { editorUrl: url, projectId, sessionId, revision: document.snapshot().revision };
  };
  const activate = async (): Promise<IEditorActivation> => {
    const value = activation();
    let response: Response;
    try {
      response = await fetch(value.editorUrl, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw new EditorError(
        503,
        `Editor URL is unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok || !(await response.text()).includes("terrain-editor"))
      throw new EditorError(503, "Project terrain editor route is not ready");
    return value;
  };
  return {
    name: "threenative-terrain-editor",
    activate,
    config: () => (viewer ? { server: { allowedHosts: [viewer.hostname] } } : {}),
    configureServer(vite) {
      if (
        vite.config.server.host &&
        !["127.0.0.1", "localhost", "::1"].includes(String(vite.config.server.host))
      )
        throw new Error("Terrain editor writes require a loopback bind");
      const http = vite.httpServer;
      if (!http) throw new Error("Terrain editor requires a listening loopback HTTP server");
      http.once("listening", () => {
        const address = http.address();
        if (
          !address ||
          typeof address === "string" ||
          !["127.0.0.1", "::1"].includes(address.address)
        )
          throw new Error("Terrain editor writes require a loopback bind");
        origin = `http://${address.address === "::1" ? "[::1]" : address.address}:${address.port}`;
        url = viewer?.href ?? new URL(PREFIX, origin).href;
        console.log(`Terrain editor: ${url}`);
      });
      vite.watcher.add(document.path);
      const refresh = (path: string): void => {
        if (resolve(path) === document.path) document.refresh();
      };
      vite.watcher.on("add", refresh).on("change", refresh).on("unlink", refresh);
      const heartbeat = setInterval(() => {
        for (const response of clients) if (!response.write(": keepalive\n\n")) response.end();
      }, 15000);
      heartbeat.unref();
      http.once("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        for (const response of clients) response.end();
        vite.watcher.off("add", refresh).off("change", refresh).off("unlink", refresh);
      });
      vite.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0];
        if (!path?.startsWith(`${PREFIX}api/`)) return next();
        void (async () => {
          try {
            if (!origin) throw new EditorError(503, "Server is not ready");
            const remote = request.socket.remoteAddress;
            if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? ""))
              throw new EditorError(403, "Loopback clients only");
            const requestUrl = new URL(`http://${request.headers.host}`);
            const local = new URL(origin);
            const localhost = new URL(origin.replace("127.0.0.1", "localhost"));
            const hosts = [local.host, localhost.host, ...(viewer ? [viewer.host] : [])];
            const origins = [local.origin, localhost.origin, ...(viewer ? [viewer.origin] : [])];
            if (!hosts.includes(requestUrl.host)) throw new EditorError(403, "Untrusted host");
            if (request.headers.origin && !origins.includes(request.headers.origin))
              throw new EditorError(403, "Untrusted origin");
            if (request.method === "GET" && path === `${PREFIX}api/activate`) {
              json(response, 200, await activate());
              return;
            }
            if (request.method === "GET" && path === `${PREFIX}api/document`) {
              json(response, 200, document.snapshot());
              return;
            }
            if (request.method === "GET" && path === `${PREFIX}api/events`) {
              response.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
                connection: "keep-alive",
              });
              clients.add(response);
              response.on("close", () => clients.delete(response));
              response.write(`data: ${JSON.stringify(document.snapshot())}\n\n`);
              return;
            }
            if (request.method === "POST" && path === `${PREFIX}api/document`) {
              json(response, 200, document.commit(await body(request)));
              return;
            }
            if (request.method === "POST" && path === `${PREFIX}api/cameras`) {
              const transaction = await body(request);
              if (
                !transaction ||
                typeof transaction !== "object" ||
                Array.isArray(transaction) ||
                Object.keys(transaction).some((key) => !["baseRevision", "operation"].includes(key))
              )
                throw new Error("Expected { baseRevision, operation }");
              const cameras = transaction as { baseRevision?: unknown; operation?: unknown };
              const current = document.snapshot();
              if (cameras.baseRevision !== current.revision)
                throw new EditorError(409, "Stale base revision");
              // Cameras are authoring metadata: no evaluator, no erosion and no collider rebuild.
              const result: ICameraResult = runCameraOperation(
                {
                  cameras: current.document.cameras ?? [],
                  activeCamera: current.document.activeCamera ?? null,
                },
                cameras.operation,
              );
              const next = validate({
                ...current.document,
                cameras: result.cameras,
                activeCamera: result.activeCamera,
              });
              // Reads and no-op updates leave the document, and its revision, untouched.
              const changed =
                JSON.stringify(result.cameras) !== JSON.stringify(current.document.cameras ?? []) ||
                result.activeCamera !== (current.document.activeCamera ?? null);
              const revision = changed
                ? document.commit({ baseRevision: current.revision, document: next }).revision
                : current.revision;
              json(response, 200, { ...result, revision });
              return;
            }
            if (request.method === "POST" && path === `${PREFIX}api/inspect`) {
              const transaction = await body(request);
              if (
                !transaction ||
                typeof transaction !== "object" ||
                Array.isArray(transaction) ||
                Object.keys(transaction).some((key) => !["baseRevision", "query"].includes(key))
              )
                throw new Error("Expected { baseRevision, query }");
              const snapshot = document.snapshot();
              const inspection = transaction as { baseRevision?: unknown; query?: unknown };
              if (inspection.baseRevision !== snapshot.revision)
                throw new EditorError(409, "Stale base revision");
              // The headless evaluator is the same one the GUI renders from, so both agree.
              const state = evaluator.evaluate(snapshot.document.recipe);
              const result: ISpatialObservation = inspectSpatial(
                state,
                snapshot.revision,
                inspection.query as ISpatialQuery,
              );
              json(response, 200, { result });
              return;
            }
            throw new EditorError(405, "Unsupported terrain editor route/method");
          } catch (error) {
            json(response, error instanceof EditorError ? error.status : 400, {
              error: error instanceof Error ? error.message : String(error),
              snapshot: document.snapshot(),
            });
          }
        })();
      });
    },
  };
}
