/** Types for the `ci-required` verdict, which runs on bare Node with nothing installed. */

import type { CheckFamily } from "./ci-check-families.d.mts";

export interface ICiRequiredRow {
  readonly job: string;
  readonly ok: boolean;
  /** The job's Actions result, or `"missing"` when the run reported none. */
  readonly result: string;
  readonly selected: boolean;
  readonly why: string;
}

export interface ICiRequiredOptions {
  readonly eventName: string;
  readonly families: string;
  readonly results: string;
}

export declare function parseArgs(argv: readonly string[]): ICiRequiredOptions;
export declare function ciRequiredRows(
  results: Readonly<Record<string, { result?: string } | undefined>>,
  families: ReadonlySet<CheckFamily>,
  eventName: string,
): readonly ICiRequiredRow[];
export declare function formatCiRequired(
  rows: readonly ICiRequiredRow[],
  families: ReadonlySet<CheckFamily>,
): string;
