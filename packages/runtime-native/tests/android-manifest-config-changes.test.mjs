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

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

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
