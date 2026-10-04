import {
  type ITerrainJob,
  type ITerrainJobResult,
  runTerrainJob,
  terrainJobTransfers,
} from "./terrain-jobs.js";

/** The worker half of the terrain jobs: one message in, one transferred result back. */
interface IWorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown, transfer?: Transferable[]) => void;
}

const scope = globalThis as unknown as IWorkerScope;

scope.onmessage = (event: MessageEvent): void => {
  const request = event.data as { id: number; job: ITerrainJob };
  const result: ITerrainJobResult = runTerrainJob(request.job);
  scope.postMessage({ id: request.id, result }, terrainJobTransfers(result));
};
