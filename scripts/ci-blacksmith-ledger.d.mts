import type { IControl, IRequest, IRoute } from "./ci-blacksmith-policy.mjs";
export interface IEntry {
  request: IRequest;
  state: string;
  units: number;
  finalBilling?: IFinalBilling;
}
export interface IFinalBilling {
  key: string;
  billingComplete: boolean;
  billedPeriods: string[];
  billingEndedAt: number;
}
export interface IHistoricalObservation {
  organization: string;
  period: string;
  scope: string;
  complete: boolean;
  final: boolean;
  units: string;
  used: number;
  observedAt: number;
  dataThrough: number;
  periodStart: number;
  periodEnd: number;
  attempts: IFinalBilling[];
}
export interface ILedger {
  version: number;
  organization: string;
  snapshots: Record<
    string,
    { used: number; dataThrough: number; periodStart: number; periodEnd: number }
  >;
  entries: Record<string, IEntry>;
}
export interface ILedgerAuthority {
  read(): Promise<{ sha: string; ledger: ILedger }>;
  compareAndSwap(sha: string, ledger: ILedger): Promise<boolean>;
}
export interface IReconciliationResult {
  ok: boolean;
  reason?: string;
}
export interface ICompletion {
  key: string;
  state: string;
  exactKey?: string;
  providerConfirmedNonBilling?: boolean;
  includedKeys?: string[];
}
export function reservationKey(request: IRequest): string;
export function reconcile(ledger: ILedger, completion: ICompletion): ILedger;
export function recordCompletion(
  authority: Partial<ILedgerAuthority>,
  completion: ICompletion,
  options?: { deadlineMs?: number },
): Promise<IReconciliationResult>;
export function recoverClosedPeriod(
  authority: Partial<ILedgerAuthority>,
  report: unknown,
  now: number,
  options?: { deadlineMs?: number },
): Promise<IReconciliationResult>;
export function admit(
  authority: Partial<ILedgerAuthority>,
  request: unknown,
  report: unknown,
  config: Partial<IControl>,
  now: number,
  options?: { deadlineMs?: number },
): Promise<IRoute>;
export function createContentsLedger(
  token: string,
  fetcher?: (url: string, init: RequestInit) => Promise<Response>,
): ILedgerAuthority;
