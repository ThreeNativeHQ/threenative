/**
 * Explain which render workloads should be collapsed or retained.
 * @situation diagnose a slow Three.js scene
 * @situation choose a render optimization from observed workload data
 * @constraint use measured input rather than visual guesses
 * @example const advice = adviseThreeRenderWorkload(input);
 */
export { adviseThreeRenderWorkload } from "./renderWorkloadAdvisor.js";
export type {
  IRenderAdvisorExamplePaths,
  IRenderAdvisorInput,
  IRenderAdvisorObservedInput,
  IRenderAdvisorObservedPass,
  IRenderAdvisorRecommendation,
  IRenderAdvisorReport,
  IRenderAdvisorSceneCollapseAggregate,
} from "./renderWorkloadAdvisor.js";
/**
 * Install the playtest observation bridge for a plain Three.js game.
 * @situation expose a non-ThreeNative game to the scenario runner
 * @situation add semantic observations to a browser playtest
 * @constraint install once before the runner connects
 * @example const bridge = installThreePlaytestBridge(options);
 */
export { installThreePlaytestBridge } from "./bridge.js";
export type {
  IThreePlaytestBridgeInstallation,
  IThreePlaytestBridgeOptions,
  IThreePlaytestResources,
} from "./bridge.js";
/**
 * Record Three.js physics bodies for playtest observations.
 * @situation assert physics contacts in a plain Three.js game
 * @situation capture bounded body state for a scenario
 * @constraint keep recorder limits within the documented caps
 * @example const physics = new ThreePlaytestPhysicsRecorder();
 */
export {
  PLAYTEST_PHYSICS_BODY_LIMIT,
  PLAYTEST_PHYSICS_SAMPLE_LIMIT,
  ThreePlaytestPhysicsRecorder,
} from "./physics.js";
export type { IThreePlaytestPhysics, IThreePlaytestPhysicsBody } from "./physics.js";
/**
 * Connect a device-hosted game to the playtest bridge.
 * @situation run the same playtest on an Android or iOS target
 * @situation read the device bridge endpoint
 * @constraint use the device transport selected by the runner
 * @example const connection = await connectDevicePlaytestBridge();
 */
export { connectDevicePlaytestBridge, readPlaytestEndpoint } from "./device.js";
export type { IDeviceBridgeInstallation } from "./device.js";
export type { IThreePlaytestEntity } from "./entities.js";
/**
 * Measure a Three.js pose for grounded or attachment-aware checks.
 * @situation inspect a skinned model's posed bounds
 * @situation verify a character's visual pose in a playtest
 * @constraint precise per-vertex measurement is opt-in and not for frame loops
 * @example const measurement = measureThreePose(model);
 */
export { measureThreePose, posedBounds } from "./pose.js";
export type {
  IMeasureThreePoseOptions,
  IThreePoseBounds,
  IThreePoseMeasurement,
  ThreePoseQuaternion,
  ThreePoseVector,
} from "./pose.js";
