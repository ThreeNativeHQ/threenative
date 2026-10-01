import type { PatchCommand } from "../core/terrain.js";
import type { ITerrainState } from "../core/types.js";
import { mountRecoveredEditor } from "./app.js";
import type { IAuthoringDocument, IEditorActivation, IEditorSnapshot } from "./server.js";
import { editorShell } from "./shell.js";

export interface IEditorView {
  readonly backend: string;
  update(state: ITerrainState): ITerrainState | undefined;
  setDocument(document: IAuthoringDocument, revision: string): void;
  pick(clientX: number, clientY: number): [number, number, number] | null;
  setMode(mode: string): void;
  setBrush(
    brush: { at: [number, number]; radius: number; rotation?: number; shape?: string } | null,
  ): void;
  showSpline(points: readonly [number, number, number][]): void;
  setNavigation(enabled: boolean): void;
  setSelection?(enabled: boolean): void;
  selectLayer?(id: string): void;
  setView(view: string): void;
  frame(): void;
  registerAsset?(id: string, object: unknown): void;
  dispose(): void;
}

/**
 * HTTP controller for the project-local terrain editor.
 * @requires npm i -D @threenative/terrain
 * @situation inspect and atomically edit the terrain editor from an agent
 * @constraint optional tooling; only subscribe/mount touches DOM; stale revisions fail explicitly
 * @example const controller = new TerrainEditorController(editorUrl); const snapshot = await controller.snapshot();
 * @override editorUrl is the activation-returned project URL
 */
export class TerrainEditorController {
  readonly baseUrl: string;
  constructor(editorUrl: string) {
    const url = new URL(editorUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Expected an HTTP(S) terrain editor URL");
    this.baseUrl = new URL("api/", url).href;
  }
  async #request<T>(route: string, transaction?: unknown): Promise<T> {
    const response = await fetch(
      new URL(route, this.baseUrl),
      transaction === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(transaction),
          },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
    return result as T;
  }
  activate(): Promise<IEditorActivation> {
    return this.#request("activate");
  }
  snapshot(): Promise<IEditorSnapshot> {
    return this.#request("document");
  }
  commit(
    transaction:
      | { baseRevision: string; document: IAuthoringDocument }
      | { baseRevision: string; commands: readonly PatchCommand[] },
  ): Promise<IEditorSnapshot> {
    return this.#request("document", transaction);
  }
  subscribe(listener: (snapshot: IEditorSnapshot) => void, onError: () => void): () => void {
    const events = new EventSource(new URL("events", this.baseUrl));
    events.onmessage = ({ data }) => {
      try {
        listener(JSON.parse(data) as IEditorSnapshot);
      } catch {
        onError();
      }
    };
    events.onerror = onError;
    return () => events.close();
  }
}

/**
 * Mount recovered terrain controls around the project-owned ThreeNative view.
 * @requires npm i -D @threenative/terrain
 * @situation open the terrain brush and layer GUI around game-owned rendering
 * @constraint browser authoring only; createView and materialColours are required game choices
 * @example await mountTerrainEditor({ createView: createEditorView, materialColours: terrainPalette });
 * @override createView owns the renderer scene, materials, lighting and camera
 */
export async function mountTerrainEditor(options: {
  createView(host: HTMLElement, controller: TerrainEditorController): Promise<IEditorView>;
  materialColours: readonly (readonly [number, number, number])[];
  onEvaluated?(event: { revision: string; state: ITerrainState; ms: number }): void;
}): Promise<{ controller: TerrainEditorController; dispose(): void }> {
  document.body.innerHTML = editorShell;
  const lock = document.createElement("style");
  lock.textContent =
    'body[data-saving="true"] button,body[data-saving="true"] input,body[data-saving="true"] select,body[data-saving="true"] textarea{pointer-events:none}';
  document.head.append(lock);
  const host = document.getElementById("viewport");
  if (!host) throw new Error("Recovered editor has no viewport");
  const controller = new TerrainEditorController(new URL("./", location.href).href);
  const initial = await controller.snapshot();
  const view = await options.createView(host, controller);
  let unsubscribe = () => {};
  const controls = mountRecoveredEditor({
    initial,
    providedView: view,
    materialColours: options.materialColours,
    commit: (transaction: Parameters<typeof controller.commit>[0]) =>
      controller.commit(transaction),
    getSnapshot: () => controller.snapshot(),
    subscribe: (listener: (snapshot: IEditorSnapshot) => void) => {
      unsubscribe = controller.subscribe(listener, () => {
        const status = document.getElementById("save-status");
        if (status) status.textContent = "Connection interrupted · waiting for project";
      });
    },
    onEvaluated: options.onEvaluated,
  });
  const title = document.getElementById("project-name");
  if (title) title.textContent = "Project terrain";
  return {
    controller,
    dispose: () => {
      unsubscribe();
      controls.dispose();
      view.dispose();
      lock.remove();
    },
  };
}
