/**
 * Connect a Playwright page to a playtest bridge.
 * @situation run a browser scenario against a game
 * @situation inspect bridge diagnostics from a runner
 * @constraint the bridge must answer the handshake or the run fails
 * @example const bridge = await connectPlaytestBridge(page);
 */
export * from "./bridgeClient.js";
// `WEBGPU_BROWSER_ARGS` lives here. Without it an external consumer cannot reproduce the browser
// arguments this repository's own gates depend on — and a WebGPU run that reaches SwiftShader
// instead of the Vulkan driver reports healthy-looking numbers from a CPU rasteriser.
/**
 * Select safe Chromium arguments for WebGPU playtests.
 * @situation run a browser playtest with Vulkan WebGPU
 * @situation reject a SwiftShader adapter as evidence
 * @constraint inspect the adapter name before claiming GPU proof
 * @example const args = resolveBrowserArguments(undefined);
 */
export * from "./browser.js";
/**
 * Drive and inspect Android playtest transport.
 * @situation run a scenario on an Android emulator or device
 * @situation parse Android console diagnostics
 * @constraint Android evidence must name its target and transport
 * @example const adb = discoverAdb(process.env);
 */
export * from "./android.js";
/**
 * Run a playtest on Android through the configured device transport.
 * @situation execute a scenario on an Android target
 * @situation collect Android playtest artifacts
 * @constraint the app bundle and device transport must be prepared
 * @example await runAndroidPlaytest(options);
 */
export * from "./androidRunner.js";
/**
 * Parse standalone playtest runner configuration.
 * @situation invoke the playtest CLI from a scaffold
 * @situation validate runner flags before launching a browser
 * @constraint invalid flags throw a named usage error
 * @example const config = parseStandalonePlaytestArgs(argv);
 */
export * from "./config.js";
/**
 * Drive a local desktop playtest mailbox.
 * @situation run a desktop target through the playtest protocol
 * @situation exchange observations with a native desktop host
 * @constraint the mailbox lifecycle must be disposed after the run
 * @example const driver = new DesktopPlaytestDriver(options);
 */
export * from "./desktop.js";
/**
 * Run a desktop playtest and collect its report.
 * @situation execute a scenario against the desktop host
 * @situation verify native desktop behavior from the same scenario
 * @constraint the desktop host must be built before launching
 * @example await runDesktopPlaytest(options);
 */
export * from "./desktopRunner.js";
/**
 * Initialize the standalone playtest files for a project.
 * @situation add the runner contract to a new game
 * @situation create a starter scenario fixture
 * @constraint generated scenarios must contain real assertions
 * @example await initStandalonePlaytest(projectPath);
 */
export * from "./init.js";
/**
 * Drive and inspect iOS simulator playtest transport.
 * @situation run a scenario on the iOS simulator
 * @situation parse the launched native process identifier
 * @constraint simulator evidence does not claim physical-device proof
 * @example const driver = new XcrunIosDriver(options);
 */
export * from "./ios.js";
/**
 * Run a playtest on the iOS simulator or device transport.
 * @situation execute a scenario on an iOS target
 * @situation collect iOS playtest artifacts
 * @constraint identify simulator versus physical transport in evidence
 * @example await runIosPlaytest(options);
 */
export * from "./iosRunner.js";
/**
 * Convert captured runner observations into a replay scenario.
 * @situation preserve a failing playtest as a replay fixture
 * @situation require assertions before recording a scenario
 * @constraint an empty assertion set is a failure
 * @example const scenario = recordToScenario(recording);
 */
export * from "./recording.js";
/**
 * Execute scenario steps, assertions, and evidence capture.
 * @situation run a complete browser or device playtest
 * @situation capture diagnostics and screenshots from a managed server
 * @constraint missing observations and malformed assertions fail closed
 * @example const report = await runStandalonePlaytest(options);
 */
export * from "./runner.js";
/**
 * Resolve a native device transport and its mailbox paths.
 * @situation connect a native host to the playtest runner
 * @situation validate an Android or iOS device endpoint
 * @constraint paths stay inside the managed artifact directory
 * @example const paths = deviceMailboxPaths(projectRoot);
 */
export * from "./deviceTransport.js";
