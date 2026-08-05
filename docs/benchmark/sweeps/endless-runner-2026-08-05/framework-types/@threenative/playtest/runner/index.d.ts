import { IPlaytestProtocolDiagnostic, IPlaytestScenario, IPlaytestReport, IPlaytestObservations } from '../index.js';
import { d as IPlaytestSetupRequest, e as IPlaytestBridgeDescription, a as IPlaytestSampleRequest, I as IPlaytestObservationSnapshot } from '../protocol-BrSrLHZX.js';
import { Page } from 'playwright';

declare class PlaytestBridgeError extends Error {
    readonly diagnostic: IPlaytestProtocolDiagnostic;
    constructor(diagnostic: IPlaytestProtocolDiagnostic);
}
interface IPlaytestBridgeClient {
    advance(ticks: number): Promise<void>;
    applySetup(request: IPlaytestSetupRequest): Promise<void>;
    description: IPlaytestBridgeDescription;
    sample(request: IPlaytestSampleRequest): Promise<IPlaytestObservationSnapshot>;
}
declare function connectPlaytestBridge(page: Page, scenario: IPlaytestScenario, timeoutMs?: 5000): Promise<IPlaytestBridgeClient | undefined>;

interface IPlaytestServerConfig {
    command: string;
    cwd?: string;
    timeoutMs?: number;
}
interface IStandalonePlaytestConfig {
    artifactDirectory: string;
    browserArgs?: readonly string[];
    headless: boolean;
    projectPath: string;
    scenarioPath: string;
    server?: IPlaytestServerConfig;
    timeoutMs: number;
    trace: boolean;
    url: string;
}
declare function parseStandalonePlaytestArgs(argv: readonly string[], cwd?: string): IStandalonePlaytestConfig;

declare function initStandalonePlaytest(projectPath?: string): Promise<{
    created: string[];
}>;

interface IStandalonePlaytestReport extends IPlaytestReport {
    artifactDirectory: string;
    pass: boolean;
    runtime: "web";
    scenario: string;
    target: string;
    url: string;
}
declare function runStandalonePlaytest(config: IStandalonePlaytestConfig): Promise<IStandalonePlaytestReport>;
declare function buildReport(config: IStandalonePlaytestConfig, scenario: IPlaytestScenario, beforeSnapshot: IPlaytestObservationSnapshot | undefined, afterSnapshot: IPlaytestObservationSnapshot | undefined, consoleEntries: Array<{
    text: string;
    type: string;
}>, networkEntries: Array<{
    method: string;
    url: string;
}>, pathLength?: number | undefined, hud?: Record<string, {
    after?: unknown;
    before?: unknown;
}>, runtimeReady?: boolean, visual?: IPlaytestObservations["visual"]): IStandalonePlaytestReport;

export { type IPlaytestBridgeClient, type IPlaytestServerConfig, type IStandalonePlaytestConfig, type IStandalonePlaytestReport, PlaytestBridgeError, buildReport, connectPlaytestBridge, initStandalonePlaytest, parseStandalonePlaytestArgs, runStandalonePlaytest };
