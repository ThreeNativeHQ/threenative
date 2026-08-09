import { d as IPlaytestSetupRequest, J as JsonValue, e as IPlaytestBridgeDescription, a as IPlaytestSampleRequest, I as IPlaytestObservationSnapshot } from '../protocol-BdpanW_B.js';
import { IPlaytestProtocolDiagnostic, IPlaytestScenario, IPlaytestReport, IPlaytestObservations, IPlaytestDiagnostic } from '../index.js';
import { Page } from 'playwright';

declare class PlaytestBridgeError extends Error {
    readonly diagnostic: IPlaytestProtocolDiagnostic;
    constructor(diagnostic: IPlaytestProtocolDiagnostic);
}
interface IPlaytestBridgeClient {
    advance(ticks: number): Promise<void>;
    applySetup(request: IPlaytestSetupRequest): Promise<void>;
    drainEvents(limit?: number): Promise<JsonValue[]>;
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
interface IPlaytestFlagHelp {
    default: string;
    summary: string;
    takesValue: boolean;
    allowDashValue?: boolean;
    repeatable?: boolean;
}
declare const PLAYTEST_FLAGS: {
    readonly "--artifacts": {
        readonly default: "artifacts/playtest";
        readonly summary: "artifact output directory";
        readonly takesValue: true;
    };
    readonly "--browser-arg": {
        readonly allowDashValue: true;
        readonly default: "none (repeatable)";
        readonly repeatable: true;
        readonly summary: "one additional Chromium argument";
        readonly takesValue: true;
    };
    readonly "--browser-recipe": {
        readonly default: "none";
        readonly summary: "named browser recipe (webgpu)";
        readonly takesValue: true;
    };
    readonly "--headed": {
        readonly default: "false";
        readonly summary: "show the browser window";
        readonly takesValue: false;
    };
    readonly "--project": {
        readonly default: ".";
        readonly summary: "project root used to resolve paths";
        readonly takesValue: true;
    };
    readonly "--scenario": {
        readonly default: "required (or positional)";
        readonly summary: "scenario JSON path";
        readonly takesValue: true;
    };
    readonly "--server-command": {
        readonly default: "none";
        readonly summary: "command for a managed app server";
        readonly takesValue: true;
    };
    readonly "--server-timeout": {
        readonly default: "15000";
        readonly summary: "managed server readiness timeout in ms";
        readonly takesValue: true;
    };
    readonly "--timeout": {
        readonly default: "15000";
        readonly summary: "page operation timeout in ms";
        readonly takesValue: true;
    };
    readonly "--trace": {
        readonly default: "false";
        readonly summary: "write a Playwright trace";
        readonly takesValue: false;
    };
    readonly "--url": {
        readonly default: "http://127.0.0.1:5173";
        readonly summary: "application URL";
        readonly takesValue: true;
    };
};
declare class PlaytestCliUsageError extends Error {
    constructor(message: string);
}
declare function formatUsage(): string;
declare function parseStandalonePlaytestArgs(argv: readonly string[], cwd?: string): IStandalonePlaytestConfig;

declare function initStandalonePlaytest(projectPath?: string): Promise<{
    created: string[];
}>;

declare function requireAssertions(value: IPlaytestScenario["assert"], scenarioPath: string): NonNullable<IPlaytestScenario["assert"]>;
declare function recordToScenario(value: unknown, scenarioPath?: string, oracleValue?: unknown): IPlaytestScenario;

declare const STANDALONE_PLAYTEST_OBSERVATION_FIELDS: readonly ["components", "componentSeries", "console", "hud", "network", "resources", "resourceSeries", "runtimeDiagnostics", "runtimeObservations", "signals", "signalSeries", "visual"];

interface IStandalonePlaytestReport extends IPlaytestReport {
    artifactDirectory: string;
    pass: boolean;
    runtime: "web";
    scenario: string;
    target: string;
    url: string;
}
interface LabeledPlaytestSample {
    label: string;
    signals: unknown[];
    snapshot: IPlaytestObservationSnapshot;
}
declare function runStandalonePlaytest(config: IStandalonePlaytestConfig): Promise<IStandalonePlaytestReport>;
declare function preflightDisplay(config: Pick<IStandalonePlaytestConfig, "headless">, scenario: Pick<IPlaytestScenario, "artifacts" | "assert" | "steps">, environment?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): IPlaytestDiagnostic | undefined;
declare function buildReport(config: IStandalonePlaytestConfig, scenario: IPlaytestScenario, beforeSnapshot: IPlaytestObservationSnapshot | undefined, afterSnapshot: IPlaytestObservationSnapshot | undefined, consoleEntries: Array<{
    text: string;
    type: string;
}>, networkEntries: Array<{
    method: string;
    url: string;
}>, pathLength?: number | undefined, hud?: Record<string, {
    after?: unknown;
    before?: unknown;
}>, runtimeReady?: boolean, visual?: IPlaytestObservations["visual"], labeledSamples?: readonly LabeledPlaytestSample[]): IStandalonePlaytestReport;

export { type IPlaytestBridgeClient, type IPlaytestFlagHelp, type IPlaytestServerConfig, type IStandalonePlaytestConfig, type IStandalonePlaytestReport, PLAYTEST_FLAGS, PlaytestBridgeError, PlaytestCliUsageError, STANDALONE_PLAYTEST_OBSERVATION_FIELDS, buildReport, connectPlaytestBridge, formatUsage, initStandalonePlaytest, parseStandalonePlaytestArgs, preflightDisplay, recordToScenario, requireAssertions, runStandalonePlaytest };
