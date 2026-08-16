import { j as IPlaytestSetupRequest, J as JsonValue, I as IPlaytestBridgeDescription, i as IPlaytestSampleRequest, f as IPlaytestObservationSnapshot } from '../protocol-D0DV7Wxm.js';
import { j as IPlaytestProtocolDiagnostic, l as IPlaytestScenario, k as IPlaytestReport, f as IPlaytestObservations, e as IPlaytestFramebufferCoverageObservation, a as IPlaytestCaptureProvenance, c as IPlaytestDiagnosticsPolicy, I as IPlaytestAssertionResult, b as IPlaytestDiagnostic } from '../diagnostics-D22G9mwy.js';
import { Page } from 'playwright';

/** The only seam between assertion orchestration and an application bridge. */
interface IBridgeTransport {
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
declare class PlaywrightTransport implements IBridgeTransport {
    private readonly page;
    private readonly operationTimeoutMs;
    readonly capabilities: readonly ["browser.canvas", "browser.console", "browser.dom", "browser.input", "browser.network", "browser.screenshot", "browser.trace", "runtime.diagnostics", "runtime.ui"];
    constructor(page: Page, operationTimeoutMs?: number);
    call<T>(method: string, argument?: unknown): Promise<T>;
    close(): Promise<void>;
    waitForBridge(timeoutMs: number): Promise<boolean>;
}
declare function connectPlaytestBridge(page: Page, scenario: IPlaytestScenario, timeoutMs?: number): Promise<IPlaytestBridgeClient | undefined>;
declare function connectPlaytestBridgeTransport(transport: IBridgeTransport, scenario: IPlaytestScenario, timeoutMs?: number): Promise<IPlaytestBridgeClient | undefined>;

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
    setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
    startScreenRecording?(): Promise<void>;
    stop(): Promise<void>;
    stopScreenRecording?(path: string): Promise<void>;
    writeFile?(path: string, contents: string): Promise<void>;
}
interface IAndroidPointer {
    buttons?: number;
    id: number;
    x: number;
    y: number;
}
interface IAndroidPointerInjection {
    activeIds: number[];
    injection: "adb-emu-event-protocol-b";
    rotation: number;
    trackingIds: number[];
}
declare class AdbAndroidDriver implements IAndroidDriver {
    private readonly options;
    private static readonly COVERAGE_VIDEO_PATH;
    private readonly adbPath;
    private screenrecord?;
    private screenrecordError?;
    private readonly touchSlots;
    private nextTrackingId;
    private rotation?;
    constructor(options: IAndroidDriverOptions);
    prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
    captureConsole(): Promise<Array<{
        text: string;
        type: string;
    }>>;
    screenshot(path: string): Promise<void>;
    startScreenRecording(): Promise<void>;
    stopScreenRecording(path: string): Promise<void>;
    isAlive(): Promise<boolean>;
    setPointers(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
    readFile(path: string): Promise<string | undefined>;
    removeFile(path: string): Promise<void>;
    stop(): Promise<void>;
    private readRotation;
    writeFile(path: string, contents: string): Promise<void>;
    private adb;
    private waitForScreenRecorder;
    private abortScreenRecording;
    private serialArgs;
}
declare function parseAndroidConsole(output: string): Array<{
    text: string;
    type: string;
}>;
/**
 * Splits slot identity from coordinates into separate synced `adb emu event send` batches.
 *
 * The emulator console drops ABS_MT_POSITION_X/Y from any batch that also carries an
 * ABS_MT_TRACKING_ID: the command reports `OK` and the coordinates never reach the device, so
 * every contact lands at (0, 0) and a two-finger gesture reads as two touches in the same
 * screen half — the exact failure that made the simultaneous-touch proof unprovable.
 * Confirmed against `getevent -lt /dev/input/event2` on emulator 36.6.11 with the android-35
 * google_apis image. Identity goes first so a slot exists before it is positioned.
 */
declare function androidTouchBatches(identity: readonly string[], positions: readonly string[]): string[][];
declare function rotatedTouchPosition(x: number, y: number, rotation: number): [number, number];
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

declare const ANDROID_TRANSPORT_CAPABILITIES: readonly ["browser.console", "browser.input", "browser.screenshot", "runtime.diagnostics"];
interface IDeviceMailbox {
    read(path: string): Promise<string | undefined>;
    remove(path: string): Promise<void>;
    write(path: string, contents: string): Promise<void>;
}
interface IDeviceMailboxPaths {
    request: string;
    response: string;
}
interface IDevicePlaytestTransport extends IBridgeTransport {
    start(): Promise<void>;
}
declare class DeviceBridgeTransport implements IDevicePlaytestTransport {
    readonly capabilities: readonly ["browser.console", "browser.input", "browser.screenshot", "runtime.diagnostics"];
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
declare class DeviceMailboxTransport implements IDevicePlaytestTransport {
    private readonly mailbox;
    private readonly paths;
    readonly capabilities: readonly ["browser.console", "browser.input", "browser.screenshot", "runtime.diagnostics"];
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

declare const STANDALONE_PLAYTEST_OBSERVATION_FIELDS: readonly ["components", "componentSeries", "console", "framebufferCoverage", "hud", "network", "physicsDebugSeries", "performanceSeries", "resources", "resourceSeries", "runtimeDiagnostics", "runtimeObservations", "signals", "signalSeries", "visual"];

interface IStandalonePlaytestReport extends IPlaytestReport {
    artifactDirectory: string;
    pass: boolean;
    runtime: "native" | "web";
    scenario: string;
    target: string;
    url: string;
}
declare function failedDiagnosticsAssertion(policy: IPlaytestDiagnosticsPolicy): IPlaytestAssertionResult;
declare function writeCaptureProvenance(artifactDirectory: string, provenance: IPlaytestCaptureProvenance): Promise<void>;
interface ILabeledPlaytestSample {
    label: string;
    signals: unknown[];
    snapshot: IPlaytestObservationSnapshot;
}
type RunnerConsoleEntry = {
    source?: "browser-console" | "page-error" | "unhandled-rejection";
    text: string;
    type: string;
};
interface IMovementSampleInterval {
    after: IPlaytestObservationSnapshot;
    before: IPlaytestObservationSnapshot;
    inputDriven: boolean;
}
declare function runStandalonePlaytest(config: IStandalonePlaytestConfig): Promise<IStandalonePlaytestReport>;
declare function preflightDisplay(config: Pick<IStandalonePlaytestConfig, "headless">, scenario: Pick<IPlaytestScenario, "artifacts" | "assert" | "steps">, environment?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): IPlaytestDiagnostic | undefined;
declare function buildReport(config: IStandalonePlaytestConfig, scenario: IPlaytestScenario, beforeSnapshot: IPlaytestObservationSnapshot | undefined, afterSnapshot: IPlaytestObservationSnapshot | undefined, consoleEntries: RunnerConsoleEntry[], networkEntries: Array<{
    method: string;
    url: string;
}>, pathLength?: number | undefined, hud?: Record<string, {
    after?: unknown;
    before?: unknown;
}>, runtimeReady?: boolean, visual?: IPlaytestObservations["visual"], labeledSamples?: readonly ILabeledPlaytestSample[], framebufferCoverage?: IPlaytestFramebufferCoverageObservation | undefined, capture?: IPlaytestCaptureProvenance | undefined, captureFailure?: {
    code: "TN_CAPTURE_BLANK";
    label: string;
    reason: string;
} | undefined, movementSamples?: readonly IMovementSampleInterval[]): IStandalonePlaytestReport;
/** Capture the largest rendered canvas without composited DOM overlays. */
declare function captureVisualSurface(page: Page, artifactPath?: string): Promise<Buffer | undefined>;
declare function playtestStepDrivesMovement(step: IPlaytestScenario["steps"][number], hasHeldInput: boolean): boolean;
/**
 * Await one teardown step, but never longer than `timeoutMs`. Returns true when the step
 * finished (or there was nothing to do) and false when it ran out of time, so the caller can
 * escalate. Teardown runs after the report is written, so a step that hangs costs the process
 * its exit rather than costing the run its result.
 */
declare function boundedTeardownStep(step: Promise<unknown> | undefined, timeoutMs: number): Promise<boolean>;
interface IPageLifecycle {
    closed: boolean;
    crashed: boolean;
    /** Every main-frame navigation, including the run's own initial one. */
    frameNavigations: string[];
    /** Main-frame navigations after the handshake settled — the ones that break a run. */
    navigations: string[];
    settled: boolean;
    /** The last console lines before the failure, which is where a device loss announces itself. */
    tail: string[];
}
/**
 * Playwright reports a crashed renderer and a navigated document with the same
 * "Execution context was destroyed" message, and the two have opposite fixes: a crash is an
 * environment or content problem, a navigation is the page moving under the run. The listeners
 * on the page record which one happened, so the report names it rather than falling through to
 * the unexplained-error catch-all. Returns undefined when the error is neither, leaving it to
 * propagate untouched.
 */
declare function pageLifecycleDiagnostic(error: unknown, lifecycle: IPageLifecycle, url: string): IPlaytestProtocolDiagnostic | undefined;
/**
 * Navigate and complete the bridge handshake, re-navigating when the page reloads itself
 * before the handshake finishes. This never retries past the handshake: no observation has
 * been taken and no assertion has been evaluated yet, so a reattempt cannot hide a failure.
 * A bridge that is genuinely missing or incompatible still fails on its own diagnostic, and
 * an exhausted retry budget fails closed on TN_PLAYTEST_PAGE_NAVIGATED rather than passing.
 */
declare function openPageAndConnectBridge(page: Page, config: IStandalonePlaytestConfig, scenario: IPlaytestScenario): Promise<IPlaytestBridgeClient | undefined>;

interface IAndroidPlaytestDependencies {
    driver?: IAndroidDriver;
    transport?: IDevicePlaytestTransport;
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
    setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
    startScreenRecording?(): Promise<void>;
    stop(): Promise<void>;
    stopScreenRecording?(path: string): Promise<void>;
    writeFile?(path: string, contents: string): Promise<void>;
}
interface IDevicePlaytestTarget {
    driver: IDevicePlaytestDriver;
    mailboxPaths: ReturnType<typeof androidMailboxPaths>;
    name: "android" | "ios";
    processName: string;
    transport?: IDevicePlaytestTransport;
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
    transport?: IDevicePlaytestTransport;
}
declare function runIosPlaytest(config: IStandalonePlaytestConfig, dependencies?: IIosPlaytestDependencies): Promise<IStandalonePlaytestReport>;

declare function requireAssertions(value: IPlaytestScenario["assert"], scenarioPath: string): NonNullable<IPlaytestScenario["assert"]>;
declare function recordToScenario(value: unknown, scenarioPath?: string, oracleValue?: unknown): IPlaytestScenario;

export { ANDROID_TRANSPORT_CAPABILITIES, AdbAndroidDriver, DeviceBridgeTransport, DeviceMailboxTransport, type IAndroidDriver, type IAndroidDriverOptions, type IAndroidPlaytestDependencies, type IAndroidPointer, type IAndroidPointerInjection, type IBridgeTransport, type IDeviceMailbox, type IDeviceMailboxPaths, type IDevicePlaytestDriver, type IDevicePlaytestTarget, type IDevicePlaytestTransport, type IIosCommandOptions, type IIosDriverOptions, type IIosPlaytestDependencies, type IPlaytestBridgeClient, type IPlaytestFlagHelp, type IPlaytestServerConfig, type IRunIosCommand, type IStandalonePlaytestConfig, type IStandalonePlaytestReport, type IosTransportKind, PLAYTEST_FLAGS, PlaytestBridgeError, PlaytestCliUsageError, PlaywrightTransport, STANDALONE_PLAYTEST_OBSERVATION_FIELDS, XcrunIosDriver, androidMailboxPaths, androidTouchBatches, boundedTeardownStep, buildReport, captureVisualSurface, connectPlaytestBridge, connectPlaytestBridgeTransport, deviceMailboxPaths, discoverAdb, failedDiagnosticsAssertion, formatUsage, initStandalonePlaytest, openPageAndConnectBridge, pageLifecycleDiagnostic, parseAndroidConsole, parseLaunchedPid, parseStandalonePlaytestArgs, playtestStepDrivesMovement, preflightDisplay, recordToScenario, requireAssertions, rotatedTouchPosition, runAndroidPlaytest, runDevicePlaytest, runIosPlaytest, runStandalonePlaytest, validateDeviceEndpoint, writeCaptureProvenance };
