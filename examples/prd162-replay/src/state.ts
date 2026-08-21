export type ReplayState = {
  frozen: boolean;
  position: number;
  recordingHash: string;
  recordingRandomState: number;
  recordingRuntimeAgent: string;
  recordingRuntimeCore: string;
  recordingSeed: number;
  recordingSha256: string;
  recordingSource: string;
  recordingStep: number;
  recordingValidated: boolean;
  skipOuterTick: boolean;
  stateHash: number;
  tick: number;
};
