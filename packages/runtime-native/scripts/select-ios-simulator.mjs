/**
 * `xcrun simctl list devices available --json` groups devices by runtime identifier, and the
 * device objects themselves carry no runtime field. Flattening the map therefore loses the
 * only evidence of which OS a device belongs to, and picking the first entry can select a
 * visionOS, watchOS, or tvOS simulator while the report still calls the run "iOS".
 *
 * This module keeps the runtime key attached and fails closed when no iOS device exists.
 */

const IOS_RUNTIME = /SimRuntime\.iOS-(\d+)-(\d+)/u;

/** @param {string} runtime */
function iosVersion(runtime) {
  const match = IOS_RUNTIME.exec(runtime);
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

/**
 * @param {unknown} listing parsed `simctl list devices available --json` output
 * @returns {{ name: string, runtime: string, state: string, udid: string }}
 */
export function selectIosSimulator(listing) {
  const devices = /** @type {Record<string, unknown>} */ (
    /** @type {{ devices?: unknown }} */ listing?.devices ?? {}
  );
  const candidates = [];
  for (const [runtime, entries] of Object.entries(devices)) {
    const version = iosVersion(runtime);
    if (version === null || !Array.isArray(entries)) continue;
    for (const device of entries) {
      if (typeof device?.udid !== 'string' || device.udid.length === 0) continue;
      if (device.isAvailable === false) continue;
      candidates.push({
        name: typeof device.name === 'string' ? device.name : 'unknown',
        runtime,
        state: typeof device.state === 'string' ? device.state : 'Shutdown',
        udid: device.udid,
        version,
      });
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      'TN_IOS_SIMULATOR_ABSENT: no available iOS simulator. `simctl list devices available` ' +
        'offered no SimRuntime.iOS-* device; a visionOS, watchOS, or tvOS simulator is not an ' +
        'iOS simulator and is never substituted.',
    );
  }
  candidates.sort((left, right) => {
    const booted = Number(right.state === 'Booted') - Number(left.state === 'Booted');
    if (booted !== 0) return booted;
    const phone = Number(right.name.startsWith('iPhone')) - Number(left.name.startsWith('iPhone'));
    if (phone !== 0) return phone;
    const major = right.version[0] - left.version[0];
    return major !== 0 ? major : right.version[1] - left.version[1];
  });
  const { name, runtime, state, udid } = candidates[0];
  return { name, runtime, state, udid };
}

/**
 * Fails closed on a report that would claim iOS for a non-iOS runtime.
 *
 * @param {string} runtime
 */
export function assertIosRuntime(runtime) {
  if (iosVersion(runtime) === null) {
    throw new Error(`TN_IOS_SIMULATOR_WRONG_RUNTIME: ${runtime} is not an iOS simulator runtime.`);
  }
  return runtime;
}
