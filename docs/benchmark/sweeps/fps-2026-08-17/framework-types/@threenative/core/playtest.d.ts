import { JsonValue } from '@threenative/playtest';
import { c as IGamePluginHooks } from './game-DRt1Qhq3.js';
import 'three';
import 'zustand/vanilla';

declare function playtest<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(options?: IPlaytestOptions): IGamePluginHooks<TState, TPhysics>;
declare const PLAYTEST_ATTACH_TIMEOUT_MS = 30000;
/**
 * Resolves when a runner first calls `describe()`, the handshake every runner performs before
 * it observes anything.
 *
 * Without this, a scenario races the game: a proof that does finite work at startup can finish
 * before the runner takes its first observation, and the assertion then reports
 * TN_PLAYTEST_ASSERTION_TRIVIAL or a zero-delta failure depending only on how fast the device
 * booted. Opt-in, because a game that holds for a runner that never arrives is worse than the
 * race for every non-test caller.
 *
 * Fails closed: if no runner attaches within the timeout, setup throws rather than quietly
 * starting anyway and reproducing the race it was added to remove.
 */
/** The global a playtest runner sets before the page loads, so a game can tell one is coming. */
declare const PLAYTEST_RUNNER_EXPECTED_GLOBAL = "__THREENATIVE_PLAYTEST_RUNNER_EXPECTED__";
interface IPlaytestOptions {
    readonly events?: () => JsonValue[];
    /**
     * Hold the frame loop until a runner attaches. Default false.
     */
    readonly holdUntilAttached?: boolean;
    /** Milliseconds to wait when `holdUntilAttached` is set. Default {@link PLAYTEST_ATTACH_TIMEOUT_MS}. */
    readonly attachTimeoutMs?: number;
}

export { type IPlaytestOptions, PLAYTEST_ATTACH_TIMEOUT_MS, PLAYTEST_RUNNER_EXPECTED_GLOBAL, playtest };
