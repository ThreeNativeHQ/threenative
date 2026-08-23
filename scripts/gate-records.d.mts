export declare const GATE_RECORDS_HEARTBEAT_INTERVAL_MS: number;

export declare function defaultRunId(now?: Date): string;
export declare function defaultOwner(): string;

export interface IGateRecordStartOptions {
  statusPath?: string;
  runId?: string;
  phase: string;
  owner?: string;
  pid?: number;
  command: string;
  repoRoot?: string;
  now?: () => Date;
}

export interface IGateRecordUpdateOptions {
  statusPath: string;
  runId: string;
  phase: string;
  owner?: string;
  pid?: number;
  now?: () => Date;
}

export declare function startGateRecord(options: IGateRecordStartOptions): Promise<void>;
export declare function heartbeatGateRecord(options: IGateRecordUpdateOptions): Promise<void>;
export declare function finishGateRecord(
  options: IGateRecordUpdateOptions & { exitCode: number },
): Promise<void>;

export interface IGateRecorder {
  heartbeat(): Promise<void>;
  /** The first terminal result stands; a second finish is a no-op. */
  finish(exitCode: number): Promise<void>;
}

/** Writes the running record immediately and keeps its heartbeat fresh until finish. */
export declare function createGateRecorder(
  options: IGateRecordStartOptions,
): Promise<IGateRecorder>;
