import type { IControl, IRequest, IRoute } from "./ci-blacksmith-policy.mjs";
export interface IEntry {
  request: IRequest;
  state: string;
  units: number;
}
export interface ILedger {
  version: number;
  organization: string;
  snapshots: Record<string, { used: number; dataThrough: number }>;
  entries: Record<string, IEntry>;
}
export interface ILedgerAuthority {
  read(): Promise<{ sha: string; ledger: ILedger }>;
  compareAndSwap(sha: string, ledger: ILedger): Promise<boolean>;
}
export function reservationKey(request: IRequest): string;
export function reconcile(
  ledger: ILedger,
  completion: {
    key: string;
    state: string;
    exactKey?: string;
    providerConfirmedNonBilling?: boolean;
    includedKeys?: string[];
  },
): ILedger;
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
