#!/usr/bin/env node

/**
 * Builds the launch-stall attribution table from a device log, and fails closed.
 *
 * PRD-218 measured a Pixel 8 cold launch where the game reported one second of asset and world
 * load and then presented nothing for twelve more. `TN_FRAME_HITCH` gave the gap's width and
 * nothing gave its contents, so the honest answer to "why is the loading screen thirty seconds"
 * was "unknown" — and an unknown that large invites a guess, which is how the same span was
 * previously written off as "startup-shaped" and left alone.
 *
 * This script turns `TN_STALL_SEGMENTS` (see `include/mystral/stall_budget.h`) into the table
 * that goes in `docs/verification/`, and asserts the one property that makes the table worth
 * reading: the named segments must account for most of the measured gap. Three ways to fail,
 * all of them loud:
 *
 *  - the log carries no `TN_STALL_SEGMENTS` line — the instrument is absent, which is exactly
 *    what reverting the instrumentation patch produces;
 *  - the log carries no `TN_COLD_START first_frame` — there is no gap to attribute against;
 *  - the named segments cover less than `--min-share` of the gap — the table would be mostly
 *    residual, and a table that is mostly "we don't know" must not read as an explanation.
 *
 * Usage:
 *   node attribute-launch-stall.mjs <logcat.txt> [--min-share 0.8] [--label "run 1"]
 */

import { readFileSync } from 'node:fs';

const SEGMENTS_MARKER = 'TN_STALL_SEGMENTS:';
const COLD_START_MARKER = 'TN_COLD_START:';
const HITCH_MARKER = 'TN_FRAME_HITCH:';
const BOOT_MARKER = 'TN_FPS_BOOT_MS:';

/** Pulls the JSON object that follows `marker`, for every occurrence, in log order. */
function extractAll(text, marker) {
  const found = [];
  let cursor = 0;
  for (;;) {
    const at = text.indexOf(marker, cursor);
    if (at === -1) break;
    cursor = at + marker.length;
    const brace = text.indexOf('{', at + marker.length - 1);
    if (brace === -1 || brace > at + marker.length) continue;
    // Balance braces rather than reading to end of line: logcat never wraps these, but a
    // truncated tail would otherwise parse as a shorter, wrong object.
    let depth = 0;
    let end = -1;
    for (let index = brace; index < text.length; index += 1) {
      const character = text[index];
      if (character === '\n') break;
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end === -1) continue;
    try {
      found.push(JSON.parse(text.slice(brace, end)));
    } catch {
      // A malformed frame is a failure of the instrument, not a line to skip quietly.
      throw new Error(
        `TN_STALL_ATTRIBUTION_MALFORMED: could not parse a ${marker} frame at offset ${brace}.`,
      );
    }
  }
  return found;
}

/** Deduplicates the double-logging every marker gets (stdout mirror plus logcat tag). */
function unique(frames) {
  const seen = new Set();
  const out = [];
  for (const frame of frames) {
    const key = JSON.stringify(frame);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(frame);
  }
  return out;
}

function formatMs(value) {
  return `${value.toFixed(0)} ms`;
}

export function attributeLaunchStall(text, { minShare = 0.8, label = 'run' } = {}) {
  const segments = unique(extractAll(text, SEGMENTS_MARKER));
  if (segments.length === 0) {
    throw new Error(
      'TN_STALL_ATTRIBUTION_MISSING: the log carries no TN_STALL_SEGMENTS line. The launch-stall ' +
        'instrument (include/mystral/stall_budget.h) is not in this build, so the gap cannot be ' +
        'attributed and this table must not be written.',
    );
  }
  const frame = segments[0];

  const coldStart = unique(extractAll(text, COLD_START_MARKER));
  const firstFrame = coldStart.find((entry) => entry.segment === 'first_frame');
  if (firstFrame === undefined) {
    throw new Error(
      'TN_STALL_ATTRIBUTION_NO_FIRST_FRAME: the log carries no TN_COLD_START first_frame segment, ' +
        'so there is no measured launch to attribute against.',
    );
  }

  const boot = unique(extractAll(text, BOOT_MARKER))[0];
  const hitch = unique(extractAll(text, HITCH_MARKER)).find((entry) => entry.gapMs !== undefined);

  // The gap, not the whole launch: asset load is honest launch cost the game already reports as
  // TN_FPS_BOOT_MS, and attributing against it would credit the named segments with time they did
  // not spend. Builds before the gap was scoped report only `toFirstFrameMs`.
  const total = frame.gapMs ?? frame.toFirstFrameMs;
  const share = frame.attributedShare;
  const rows = Object.entries(frame.segments)
    .map(([name, value]) => ({ name, ms: value.ms, calls: value.calls }))
    .sort((a, b) => b.ms - a.ms);

  const lines = [];
  lines.push(`| phase | cost | calls | share of gap |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${formatMs(row.ms)} | ${row.calls} | ${((row.ms / total) * 100).toFixed(1)} % |`,
    );
  }
  lines.push(
    `| **residual (unattributed)** | ${formatMs(frame.residualMs)} | — | ${(
      (frame.residualMs / total) *
      100
    ).toFixed(1)} % |`,
  );
  lines.push(`| **the gap (first frame's own duration)** | ${formatMs(total)} | — | 100 % |`);
  if (frame.frameBeganAtMs !== undefined && frame.frameBeganAtMs >= 0) {
    lines.push(
      `| _(before the gap: process start, bundle eval, asset load)_ | ${formatMs(
        frame.frameBeganAtMs,
      )} | — | — |`,
    );
    lines.push(
      `| _(total tap-to-first-frame)_ | ${formatMs(frame.toFirstFrameMs)} | — | — |`,
    );
  }

  const report = {
    label,
    toFirstFrameMs: frame.toFirstFrameMs,
    gapMs: total,
    frameBeganAtMs: frame.frameBeganAtMs,
    attributedMs: frame.attributedMs,
    residualMs: frame.residualMs,
    attributedShare: share,
    segments: rows,
    bootEnterTotalMs: boot?.enterTotal,
    hitchGapMs: hitch?.gapMs,
    table: lines.join('\n'),
  };

  if (!(share >= minShare)) {
    const error = new Error(
      `TN_STALL_ATTRIBUTION_UNDER_MIN: named segments account for ${(share * 100).toFixed(1)} % of ` +
        `the ${formatMs(total)} gap, below the required ${(minShare * 100).toFixed(0)} %. ` +
        `${formatMs(frame.residualMs)} is unattributed; the table would be mostly "unknown".`,
    );
    error.report = report;
    throw error;
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((argument) => !argument.startsWith('--'));
  if (file === undefined) {
    console.error('usage: attribute-launch-stall.mjs <logcat.txt> [--min-share 0.8] [--label X]');
    process.exit(2);
  }
  const readFlag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const minShare = Number(readFlag('min-share', '0.8'));
  const label = readFlag('label', 'run');
  try {
    const report = attributeLaunchStall(readFileSync(file, 'utf8'), { minShare, label });
    console.log(report.table);
    console.log('');
    console.log(
      `attributed ${(report.attributedShare * 100).toFixed(1)} % of the ${formatMs(report.gapMs)} gap ` +
        `(tap-to-first-frame ${formatMs(report.toFirstFrameMs)}, boot enterTotal ` +
        `${report.bootEnterTotalMs ?? '?'} ms, hitch gap ${report.hitchGapMs ?? '?'} ms)`,
    );
  } catch (error) {
    console.error(String(error.message ?? error));
    if (error.report) {
      console.error('');
      console.error(error.report.table);
    }
    process.exit(1);
  }
}
