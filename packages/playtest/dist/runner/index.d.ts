import { IPlaytestProtocolDiagnostic, IPlaytestScenario, IPlaytestReport } from '../index.js';
import { c as IPlaytestSetupRequest, d as IPlaytestBridgeDescription, a as IPlaytestSampleRequest, b as IPlaytestObservationSnapshot } from '../protocol-BmvPixRi.js';
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
declare function connectPlaytestBridge(page: Page, scenario: IPlaytestScenario): Promise<IPlaytestBridgeClient | undefined>;

interface IPlaytestServerConfig {
    command: string;
    cwd?: string;
    timeoutMs?: number;
}
interface IStandalonePlaytestConfig {
    artifactDirectory: string;
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

export { type IPlaytestBridgeClient, type IPlaytestServerConfig, type IStandalonePlaytestConfig, type IStandalonePlaytestReport, PlaytestBridgeError, connectPlaytestBridge, initStandalonePlaytest, parseStandalonePlaytestArgs, runStandalonePlaytest };
