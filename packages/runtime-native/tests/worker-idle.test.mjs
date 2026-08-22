import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

/**
 * PRD P2-1 — native worker idle wake gate.
 *
 * The default repository gate must not require CMake, so this harness proves
 * the worker idle contract at the source level by default: the worker's main
 * loop blocks on the input condition variable with a predicate instead of
 * polling JavaScript at ~1 kHz, and every wakeup source (postMessage,
 * terminate) notifies that variable before any join.
 *
 * When TN_WORKER_WAKE_BIN points at a compiled measurement harness (see
 * docs/verification/worker-wake-2026-08-21.md), the same tests additionally
 * execute it against real WorkerThread instances and enforce numeric bounds
 * on idle evaluations, first-message latency, and shutdown joins. A set env
 * var with a missing binary fails — observations are never skipped.
 */

const workerCpp = readFileSync(
  fileURLToPath(new URL('../src/workers/worker_thread.cpp', import.meta.url)),
  'utf8',
);

/** Extract a full function body by signature (naive brace matching). */
function functionBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function requireBody(source, signature) {
  const body = functionBody(source, signature);
  if (!body) {
    throw new Error(`fail-closed: could not locate ${signature} — the gate cannot observe it`);
  }
  return body;
}

const threadMain = () => requireBody(workerCpp, 'void WorkerThread::threadMain()');
const postMessageFn = () => requireBody(workerCpp, 'void WorkerThread::postMessage(');
const terminateFn = () => requireBody(workerCpp, 'void WorkerThread::terminate()');

/** Run the optional measurement binary and return parsed WAKE_RESULT rows. */
function runHarness(mode) {
  const bin = process.env.TN_WORKER_WAKE_BIN;
  if (!bin) return null;
  const stdout = execFileSync(bin, [mode, '500'], { encoding: 'utf8' });
  const rows = [...stdout.matchAll(/^WAKE_RESULT (.*)$/gm)].map((m) => {
    const row = {};
    for (const token of m[1].split(/\s+/)) {
      const [key, value] = token.split('=');
      row[key] = Number.isNaN(Number(value)) ? value : Number(value);
    }
    return row;
  });
  if (rows.length === 0) {
    throw new Error(`fail-closed: ${bin} ${mode} produced no WAKE_RESULT rows`);
  }
  return rows;
}

test('should block an idle worker until a message arrives', () => {
  const main = threadMain();

  // No periodic poll may remain as the correctness path: the old loop slept
  // 1 ms and evaluated JS ~940 times per idle second (measured baseline).
  if (/\bsleep_for\b|\bsleep\(/.test(main)) {
    throw new Error(
      'RED observed: idle wake bound exceeded — threadMain restored a periodic idle sleep',
    );
  }

  // The idle transition blocks on the shared condition variable with a
  // predicate covering every completion source (input, termination).
  expect(main).toMatch(/inCondition_\.wait\(\s*lock\s*,/u);
  const waitBlock = main.match(
    /inCondition_\.wait\(\s*lock\s*,\s*\[this\]\s*\{([\s\S]*?)\}\);/u,
  )?.[1];
  expect(waitBlock).toContain('terminated_');
  expect(waitBlock).toContain('inQueue_');

  // A posted message wakes the waiter: postMessage notifies the same variable.
  expect(postMessageFn()).toMatch(/inCondition_\.notify_one\(\)/u);

  // Message delivery is unchanged: the loop still drains through JS.
  expect(threadMain()).toContain('__processMessages()');

  // Runtime arm (when the measurement harness is built): idle evaluations stay
  // bounded and the first message lands well within one frame budget.
  const rows = runHarness('single');
  if (rows) {
    for (const row of rows) {
      expect(row.echo_ok).toBe(1);
      if (row.loop_evals_in_window > 5) {
        throw new Error(
          `RED observed: idle wake bound exceeded — ${row.loop_evals_in_window} JS evals in a 500 ms idle window`,
        );
      }
      if (row.latency_us > 50_000) {
        throw new Error(`first-message latency ${row.latency_us}us exceeded the 50 ms bound`);
      }
    }
  }
});

test('should deliver and terminate multiple blocked workers', () => {
  const terminate = terminateFn();

  // Termination must wake a blocked worker: it notifies the condition
  // variable BEFORE joining, or the join below can only time out.
  expect(terminate).toMatch(/Type::TERMINATE/u);
  const notifyAt = terminate.indexOf('inCondition_.notify_one()');
  const joinAt = terminate.indexOf('join()');
  if (notifyAt === -1 || (joinAt !== -1 && notifyAt > joinAt)) {
    throw new Error(
      'RED observed: worker join timeout — terminate() does not notify the idle wait before joining',
    );
  }

  // The destructor keeps its join ordering (no leak, no double-terminate).
  const destructor = requireBody(workerCpp, 'WorkerThread::~WorkerThread()');
  expect(destructor).toContain('terminate()');
  expect(destructor).toContain('join()');

  // Runtime arm (when the measurement harness is built): every blocked worker
  // answers and joins within the bound.
  const rows = runHarness('multi');
  if (rows) {
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.echo_ok).toBe(1);
      if (row.still_running !== 0 || row.join_ms > 2000) {
        throw new Error(
          `RED observed: worker join timeout — worker ${row.worker} joined=${1 - row.still_running} in ${row.join_ms}ms`,
        );
      }
    }
  }
});
