import { n as IPlaytestSetupRequest, r as JsonValue, b as IPlaytestBridgeDescription, m as IPlaytestSampleRequest, l as IPlaytestObservationSnapshot } from '../protocol-CeC1lz_G.js';
import { s as IPlaytestProtocolDiagnostic, z as IPlaytestScenario, u as IPlaytestReport, n as IPlaytestObservations, j as IPlaytestDiagnostic } from '../diagnostics-Ckm_5lrw.js';
import { Page } from 'playwright';

/** The only seam between assertion orchestration and an application bridge. */
interface BridgeTransport {
    readonly capabilities: readonly string[];
    call<T>(method: string, argument?: unknown): Promise<T>;
    close(): Promise<void>;
    waitForBridge(timeoutMs: number): Promise<boolean>;
}
declare class PlaytestBridgeError extends Error {
    readonly diagnostic: IPlaytestProtocolDiagnostic;
    constructor(diagnostic: IPlaytestProtocolDiagnostic);
}
interface IPlaytestBridgeClient {
    advance(ticks: number): Promise<void>;
    applySetup(request: IPlaytestSetupRequest): Promise<void>;
    close(): Promise<void>;
    drainEvents(limit?: number): Promise<JsonValue[]>;
    description: IPlaytestBridgeDescription;
    sample(request: IPlaytestSampleRequest): Promise<IPlaytestObservationSnapshot>;
}
declare class PlaywrightTransport implements BridgeTransport {
    private readonly page;
    readonly capabilities: readonly ["browser.canvas", "browser.console", "browser.dom", "browser.input", "browser.network", "browser.screenshot", "browser.trace", "runtime.ui"];
    constructor(page: Page);
    call<T>(method: string, argument?: unknown): Promise<T>;
    close(): Promise<void>;
    waitForBridge(timeoutMs: number): Promise<boolean>;
}
declare function connectPlaytestBridge(page: Page, scenario: IPlaytestScenario, timeoutMs?: number): Promise<IPlaytestBridgeClient | undefined>;
declare function connectPlaytestBridgeTransport(transport: BridgeTransport, scenario: IPlaytestScenario, timeoutMs?: number): Promise<IPlaytestBridgeClient | undefined>;

interface IAndroidDriverOptions {
    activity: string;
    adbPath?: string;
    packageName: string;
    serial?: string;
}
interface IAndroidDriver {
    captureConsole(): Promise<Array<{
        text: string;
        type: string;
    }>>;
    isAlive(): Promise<boolean>;
    prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
    readFile?(path: string): Promise<string | undefined>;
    removeFile?(path: string): Promise<void>;
    screenshot(path: string): Promise<void>;
    stop(): Promise<void>;
    writeFile?(path: string, contents: string): Promise<void>;
}
declare class AdbAndroidDriver implements IAndroidDriver {
    private readonly options;
    private readonly adbPath;
    constructor(options: IAndroidDriverOptions);
    prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
    captureConsole(): Promise<Array<{
        text: string;
        type: string;
    }>>;
    screenshot(path: string): Promise<void>;
    isAlive(): Promise<boolean>;
    readFile(path: string): Promise<string | undefined>;
    removeFile(path: string): Promise<void>;
    stop(): Promise<void>;
    writeFile(path: string, contents: string): Promise<void>;
    private adb;
    private serialArgs;
}
declare function discoverAdb(environment?: NodeJS.ProcessEnv): string;

interface IPlaytestServerConfig {
    command: string;
    cwd?: string;
    timeoutMs?: number;
}
interface IStandalonePlaytestConfig {
    android?: {
        activity: string;
        packageName: string;
    };
    adbPath?: string;
    artifactDirectory: string;
    browserArgs?: readonly string[];
    device?: string;
    endpoint?: string;
    headless: boolean;
    ios?: {
        appPath?: string;
        bundleId: string;
        transport: "device" | "simulator";
    };
    mailboxRoot?: string;
    projectPath: string;
    scenarioPath: string;
    server?: IPlaytestServerConfig;
    timeoutMs: number;
    target?: "android" | "browser" | "ios";
    trace: boolean;
    url: string;
    xcrunPath?: string;
}
interface IPlaytestFlagHelp {
    default: string;
    summary: string;
    takesValue: boolean;
    allowDashValue?: boolean;
    repeatable?: boolean;
}
declare const PLAYTEST_FLAGS: {
    readonly "--adb": {
        readonly default: "auto-discover";
        readonly summary: "absolute adb executable path";
        readonly takesValue: true;
    };
    readonly "--activity": {
        readonly default: ".MystralActivity";
        readonly summary: "Android launch activity";
        readonly takesValue: true;
    };
    readonly "--app": {
        readonly default: "required for iOS";
        readonly summary: "built iOS .app bundle";
        readonly takesValue: true;
    };
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
    readonly "--bundle-id": {
        readonly default: "dev.threenative.runtime";
        readonly summary: "iOS application bundle identifier";
        readonly takesValue: true;
    };
    readonly "--device": {
        readonly default: "platform default";
        readonly summary: "Android serial or iOS device identifier";
        readonly takesValue: true;
    };
    readonly "--endpoint": {
        readonly default: "http://127.0.0.1:41777/playtest";
        readonly summary: "device bridge endpoint";
        readonly takesValue: true;
    };
    readonly "--headed": {
        readonly default: "false";
        readonly summary: "show the browser window";
        readonly takesValue: false;
    };
    readonly "--mailbox-root": {
        readonly default: "Android external files directory";
        readonly summary: "native device mailbox directory";
        readonly takesValue: true;
    };
    readonly "--ios-transport": {
        readonly default: "simulator";
        readonly summary: "iOS transport (simulator or device)";
        readonly takesValue: true;
    };
    readonly "--project": {
        readonly default: ".";
        readonly summary: "project root used to resolve paths";
        readonly takesValue: true;
    };
    readonly "--package": {
        readonly default: "com.mystral.engine";
        readonly summary: "Android application id";
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
    readonly "--target": {
        readonly default: "browser";
        readonly summary: "execution target (browser, android, or ios)";
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
    readonly "--xcrun": {
        readonly default: "auto-discover";
        readonly summary: "absolute xcrun executable path";
        readonly takesValue: true;
    };
};
declare class PlaytestCliUsageError extends Error {
    constructor(message: string);
}
declare function formatUsage(): string;
declare function parseStandalonePlaytestArgs(argv: readonly string[], cwd?: string): IStandalonePlaytestConfig;

declare const ANDROID_TRANSPORT_CAPABILITIES: readonly ["browser.console", "browser.input", "browser.screenshot"];
interface IDeviceMailbox {
    read(path: string): Promise<string | undefined>;
    remove(path: string): Promise<void>;
    write(path: string, contents: string): Promise<void>;
}
interface IDeviceMailboxPaths {
    request: string;
    response: string;
}
interface DevicePlaytestTransport extends BridgeTransport {
    start(): Promise<void>;
}
declare class DeviceBridgeTransport implements DevicePlaytestTransport {
    readonly capabilities: readonly ["browser.console", "browser.input", "browser.screenshot"];
    readonly endpoint: URL;
    private connected;
    private nextId;
    private readonly pending;
    private readonly queue;
    private server?;
    private waiters;
    constructor(endpoint: string);
    start(): Promise<void>;
    call<T>(method: string, argument?: unknown): Promise<T>;
    close(): Promise<void>;
    waitForBridge(timeoutMs: number): Promise<boolean>;
    private handle;
    private markConnected;
}
declare class DeviceMailboxTransport implements DevicePlaytestTransport {
    private readonly mailbox;
    private readonly paths;
    readonly capabilities: readonly ["browser.console", "browser.input", "browser.screenshot"];
    private connected;
    private closed;
    private nextId;
    constructor(mailbox: IDeviceMailbox, paths: IDeviceMailboxPaths);
    start(): Promise<void>;
    call<T>(method: string, argument?: unknown): Promise<T>;
    close(): Promise<void>;
    waitForBridge(timeoutMs: number): Promise<boolean>;
    private waitForResponse;
    private readResponse;
}
declare function androidMailboxPaths(packageName: string, root?: string): IDeviceMailboxPaths;
declare function deviceMailboxPaths(root: string): IDeviceMailboxPaths;
declare function validateDeviceEndpoint(value: string): URL;

declare const STANDALONE_PLAYTEST_OBSERVATION_FIELDS: readonly ["components", "componentSeries", "console", "hud", "network", "resources", "resourceSeries", "runtimeDiagnostics", "runtimeObservations", "signals", "signalSeries", "visual"];

interface IStandalonePlaytestReport extends IPlaytestReport {
    artifactDirectory: string;
    pass: boolean;
    runtime: "native" | "web";
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

interface IAndroidPlaytestDependencies {
    driver?: IAndroidDriver;
    transport?: DevicePlaytestTransport;
}
interface IDevicePlaytestDriver {
    captureConsole(): Promise<Array<{
        text: string;
        type: string;
    }>>;
    isAlive(): Promise<boolean>;
    prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
    readFile?(path: string): Promise<string | undefined>;
    removeFile?(path: string): Promise<void>;
    screenshot(path: string): Promise<void>;
    stop(): Promise<void>;
    writeFile?(path: string, contents: string): Promise<void>;
}
interface IDevicePlaytestTarget {
    driver: IDevicePlaytestDriver;
    mailboxPaths: ReturnType<typeof androidMailboxPaths>;
    name: "android" | "ios";
    processName: string;
    transport?: DevicePlaytestTransport;
}
declare function runAndroidPlaytest(config: IStandalonePlaytestConfig, dependencies?: IAndroidPlaytestDependencies): Promise<IStandalonePlaytestReport>;
declare function runDevicePlaytest(config: IStandalonePlaytestConfig, target: IDevicePlaytestTarget): Promise<IStandalonePlaytestReport>;

declare function initStandalonePlaytest(projectPath?: string): Promise<{
    created: string[];
}>;

type IosTransportKind = "device" | "simulator";
interface IIosDriverOptions {
    appPath: string;
    bundleId: string;
    device?: string;
    transport: IosTransportKind;
    xcrunPath?: string;
}
interface IIosCommandOptions {
    env?: NodeJS.ProcessEnv;
}
type IRunIosCommand = (args: readonly string[], options?: IIosCommandOptions) => Promise<string>;
declare class XcrunIosDriver implements IDevicePlaytestDriver {
    private readonly options;
    private readonly run;
    private mailboxRoot?;
    private pid?;
    private suppressedResponse?;
    constructor(options: IIosDriverOptions, run?: IRunIosCommand);
    prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
    captureConsole(): Promise<Array<{
        text: string;
        type: string;
    }>>;
    isAlive(): Promise<boolean>;
    screenshot(path: string): Promise<void>;
    readFile(path: string): Promise<string | undefined>;
    removeFile(path: string): Promise<void>;
    stop(): Promise<void>;
    writeFile(path: string, contents: string): Promise<void>;
    getMailboxRoot(): string;
    private prepareSimulator;
    private prepareDevice;
    private device;
    private processName;
    private mailboxPath;
}
declare function parseLaunchedPid(output: string): string;

interface IIosPlaytestDependencies {
    driver?: IDevicePlaytestDriver & {
        getMailboxRoot?(): string;
    };
    transport?: DevicePlaytestTransport;
}
declare function runIosPlaytest(config: IStandalonePlaytestConfig, dependencies?: IIosPlaytestDependencies): Promise<IStandalonePlaytestReport>;

declare function requireAssertions(value: IPlaytestScenario["assert"], scenarioPath: string): NonNullable<IPlaytestScenario["assert"]>;
declare function recordToScenario(value: unknown, scenarioPath?: string, oracleValue?: unknown): IPlaytestScenario;

export { ANDROID_TRANSPORT_CAPABILITIES, AdbAndroidDriver, type BridgeTransport, DeviceBridgeTransport, DeviceMailboxTransport, type DevicePlaytestTransport, type IAndroidDriver, type IAndroidDriverOptions, type IAndroidPlaytestDependencies, type IDeviceMailbox, type IDeviceMailboxPaths, type IDevicePlaytestDriver, type IDevicePlaytestTarget, type IIosCommandOptions, type IIosDriverOptions, type IIosPlaytestDependencies, type IPlaytestBridgeClient, type IPlaytestFlagHelp, type IPlaytestServerConfig, type IRunIosCommand, type IStandalonePlaytestConfig, type IStandalonePlaytestReport, type IosTransportKind, PLAYTEST_FLAGS, PlaytestBridgeError, PlaytestCliUsageError, PlaywrightTransport, STANDALONE_PLAYTEST_OBSERVATION_FIELDS, XcrunIosDriver, androidMailboxPaths, buildReport, connectPlaytestBridge, connectPlaytestBridgeTransport, deviceMailboxPaths, discoverAdb, formatUsage, initStandalonePlaytest, parseLaunchedPid, parseStandalonePlaytestArgs, preflightDisplay, recordToScenario, requireAssertions, runAndroidPlaytest, runDevicePlaytest, runIosPlaytest, runStandalonePlaytest, validateDeviceEndpoint };
