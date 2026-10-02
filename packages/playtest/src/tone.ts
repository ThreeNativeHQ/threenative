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
