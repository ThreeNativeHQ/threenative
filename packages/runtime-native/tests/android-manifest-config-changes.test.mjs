// PRD-222 Phase 1 — the activity must declare every config-change axis a mid-play environment
// change can hit. An uncovered axis recreates the activity in-process, and SDL then exits the
// whole process (`nativeAllowRecreateActivity` defaults false), so a split-screen entry or a
// font-scale change cold-restarts the game and replays its loading sequence. Measured on a
// Pixel 8 and on an emulator 2026-08-25:
// docs/verification/prd-222-return-from-background-2026-08-25.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import {
  ANDROID_SUBMISSION_TARGET_SDK,
  androidGradleTargetSdk,
  assertAndroidSubmissionTargetSdk,
} from '../scripts/package-android.mjs';

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'build.gradle.kts');

function activityConfigChanges() {
  const source = readFileSync(manifestPath, 'utf8');
  const activity = /<activity\b[^>]*>/u.exec(source);
  if (!activity) throw new Error('TN_ANDROID_MANIFEST_ACTIVITY_MISSING: no <activity> in AndroidManifest.xml');
  const attribute = /android:configChanges="([^"]*)"/u.exec(activity[0]);
  if (!attribute) throw new Error('TN_ANDROID_MANIFEST_CONFIG_CHANGES_MISSING: activity declares no configChanges');
  return new Set(attribute[1].split('|'));
}

test('every axis that must not recreate the activity is covered', () => {
  const covered = activityConfigChanges();
  // smallestScreenSize is split-screen/freeform entry; the rest are user-facing display
  // settings a player can change mid-session. Each missing name re-exposes the
  // recreate → System.exit(0) death measured in the Phase 0 record.
  const required = [
    'keyboard',
    'keyboardHidden',
    'orientation',
    'screenSize',
    'smallestScreenSize',
    'screenLayout',
    'navigation',
    'uiMode',
    'density',
    'fontScale',
    'locale',
    'layoutDirection',
    'colorMode',
  ];
  const missing = required.filter((axis) => !covered.has(axis));
  if (missing.length > 0) {
    throw new Error(
      `AndroidManifest.xml is missing configChanges axes [${missing.join(', ')}]; an uncovered axis kills the process instead of resizing (PRD-222).`,
    );
  }
});

// PRD-212 phase 1. The release subject is the Gradle project that will be compiled, not a literal
// the packager hopes still matches it. A project whose targetSdk drops below the Play submission
// floor must be refused before Gradle runs, and the revert control proves the gate is the thing
// rejecting it rather than a stale source scan.
test('the packaged subject declares the submission target SDK', () => {
  const source = readFileSync(gradlePath, 'utf8');
  const declared = androidGradleTargetSdk(source);
  if (declared === undefined) throw new Error('build.gradle.kts declares no targetSdk');
  if (declared < ANDROID_SUBMISSION_TARGET_SDK) {
    throw new Error(
      `build.gradle.kts targetSdk ${declared} is below the required API ${ANDROID_SUBMISSION_TARGET_SDK}`,
    );
  }
  assertAndroidSubmissionTargetSdk(source);
});

test('the submission gate rejects a release subject below the target SDK', () => {
  const reverted = readFileSync(gradlePath, 'utf8').replace(
    /targetSdk\s*=\s*\d+/u,
    'targetSdk = 35',
  );
  let error;
  try {
    assertAndroidSubmissionTargetSdk(reverted);
  } catch (thrown) {
    error = thrown;
  }
  if (!(error instanceof Error) || !error.message.includes('TN_ANDROID_TARGET_SDK_BELOW_SUBMISSION')) {
    throw new Error(`expected TN_ANDROID_TARGET_SDK_BELOW_SUBMISSION, received ${String(error)}`);
  }
});
