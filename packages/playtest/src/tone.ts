/** Display-referred Rec.709 luminance, quantized to 256 rounded byte bins. */
export interface IToneMetrics {
  readonly mean: number;
  readonly p1: number;
  readonly p50: number;
  readonly p99: number;
  /** Fraction in bin 255 (display white). */
  readonly clipFraction: number;
  /** Fraction in bin 0 (display black). */
  readonly blackFraction: number;
}

export const TONE_METRICS = ["mean", "p1", "p50", "p99", "clipFraction", "blackFraction"] as const;

export interface IPlaytestToneObservation extends IToneMetrics {
  readonly code: "TN_TONE";
  readonly label: string;
  /** Absent for the convenience before/after captures. */
  readonly atStep?: string;
}
