declare const CAPTURE_GUARD_LIMITS: {
    readonly brightLuminance: 0.05;
    readonly minBrightPixelRatio: 0.05;
    readonly minDistinctColors: 8;
    readonly minLuminanceStdDev: 0.01;
};
interface ICaptureFrameStats {
    readonly distinctColors: number;
    readonly brightPixelRatio: number;
    readonly height: number;
    readonly luminanceStdDev: number;
    readonly width: number;
}
declare class CaptureGuardError extends Error {
    readonly label: string;
    readonly reason: string;
    readonly stats?: ICaptureFrameStats | undefined;
    readonly code = "TN_CAPTURE_BLANK";
    constructor(label: string, reason: string, stats?: ICaptureFrameStats | undefined);
}
declare function inspectFrame(png: Buffer): ICaptureFrameStats;
declare function assertCaptureNotBlank(png: Buffer, label: string): ICaptureFrameStats;
declare const assertFrameShowsSomething: typeof assertCaptureNotBlank;

export { CAPTURE_GUARD_LIMITS, CaptureGuardError, type ICaptureFrameStats, assertCaptureNotBlank, assertFrameShowsSomething, inspectFrame };
