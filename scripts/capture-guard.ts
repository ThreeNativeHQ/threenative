import type { ICaptureFrameStats } from "../packages/playtest/src/capture.js";

export {
  CAPTURE_GUARD_LIMITS,
  CaptureGuardError,
  assertCaptureNotBlank,
  assertFrameShowsSomething,
  inspectFrame,
} from "../packages/playtest/src/capture.js";
export type { ICaptureFrameStats };
export type CaptureFrameStats = ICaptureFrameStats;
