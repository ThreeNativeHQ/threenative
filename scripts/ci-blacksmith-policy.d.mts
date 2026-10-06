export interface IRequest {
  organization: string;
  repository: string;
  period: string;
  runId: string;
  attempt: number;
  candidate: string;
  workflow: string;
  job: string;
  matrix: string;
  selection: string;
  event: string;
  selected: boolean;
  timeoutMinutes: number;
  tailMinutes: number;
}
export interface IObservation {
  organization: string;
  period: string;
  scope: string;
  complete: boolean;
  freeAllowance: number;
  used: number;
  observedAt: number;
  dataThrough: number;
  periodStart: number;
  periodEnd: number;
  creditExpiresAt: number;
  includedKeys: string[];
  catalog: { label: string; factor: number; verified: boolean };
}
export interface IActivation {
  providerHardStop: boolean;
  schemaVerified: boolean;
  periodVerified: boolean;
  controllerIsolated: boolean;
  billingTailVerified: boolean;
  coldCompatibilityVerified: boolean;
  dispatchDelayVerified: boolean;
}
export interface IControl {
  mode: string;
  forceHosted: boolean;
  ceiling: number;
  maxDispatchDelayMinutes?: number;
  trustedEvent: boolean;
  authorizedActor: boolean;
  unchangedPolicy: boolean;
  activation: IActivation;
}
export interface IRoute {
  provider: "github" | "blacksmith";
  runner: string;
  reason: string;
  units?: number;
  ceiling?: number;
  key?: string;
}
export const HOSTED: "ubuntu-24.04";
export const PROVIDER: "blacksmith-4vcpu-ubuntu-2404";
export const ORGANIZATION: "ThreeNativeHQ";
export const ACTIVATION_GATES: readonly (keyof IActivation)[];
export function hosted(reason: string): IRoute;
export function integer(value: unknown): number;
export function estimatedUnits(seconds: number, factor: number): number;
export function requestIdentity(request: unknown): IRequest;
export function validateObservation(
  report: unknown,
  request: IRequest,
  now: number,
  reservationMinutes: number,
): IObservation;
export function decide(
  request: unknown,
  report: unknown,
  config: Partial<IControl>,
  now: number,
): IRoute;
