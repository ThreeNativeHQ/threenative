/**
 * Types for the plain-Node selection table.
 *
 * The module itself stays `.mjs` on purpose: the two jobs that run it are the decision job and the
 * required verdict, and neither may depend on an install or a compile step to answer.
 */

export type CheckFamily =
  | "docs"
  | "workspace"
  | "browser"
  | "playtest"
  | "templates"
  | "native"
  | "site";

export interface IPathSelection {
  readonly families: readonly CheckFamily[];
  readonly reason: string;
}

export interface IFamilySelection {
  /** Set when one path selects every family; the sentence naming that path and its rule. */
  readonly broadenedBy: string | undefined;
  readonly families: Set<CheckFamily>;
  readonly reasons: readonly { family: CheckFamily; file: string; reason: string }[];
}

export interface ICiJobSelection {
  /** `null` is a job every selection runs. */
  readonly family: CheckFamily | null;
  /** When present, the job only runs on these events. */
  readonly events?: readonly string[];
}

export declare const CHECK_FAMILIES: readonly CheckFamily[];
export declare const CI_JOB_SELECTION: Readonly<Record<string, ICiJobSelection>>;
export declare const CI_REPORTING_JOBS: readonly string[];
export declare function allFamilies(): Set<CheckFamily>;
export declare function pathSelection(file: string): IPathSelection;
export declare function selectFamilies(files: readonly string[]): IFamilySelection;
export declare function jobIsSelected(
  job: string,
  families: ReadonlySet<CheckFamily>,
  eventName: string,
): boolean;
export declare function fenceFamilies(families: ReadonlySet<CheckFamily>): string;
export declare function listFamilies(families: ReadonlySet<CheckFamily>): string;
export declare function parseFamilies(fenced: string): Set<CheckFamily>;
