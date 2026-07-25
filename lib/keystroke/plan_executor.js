'use strict';

// lib/keystroke/plan_executor.js — runKeystrokePlan, the sole plan executor
// (spec §11.3).
//
// Walks a keystroke plan produced by any builder (makeLinearKeystrokePlan,
// makeGaussianKeystrokePlan, or a future drop-in) and dispatches each atom by
// kind: 'chord' atoms to keyboard.keyChord, 'char' atoms to the native
// typeChar. It is a small dispatcher over the composition/primitive layers —
// a sibling of plotRoute (lib/path/route_executor.js), not a second copy of
// it.
//
// Cancellation: options.signal (an AbortSignal) is the sole control channel,
// checked before each atom — same "point-boundary only" contract as
// plotRoute (a chord's own holdMs dwell is not itself interruptible; abort
// only prevents the NEXT atom from starting).
//
// Safety net: keyChord already guarantees, on its own, that any modifier it
// presses gets released (in reverse order) via its own try/finally — so by
// the time control returns to this executor, a chord atom has always cleaned
// up after itself, abort or not. Per spec §11.3, this executor ALSO calls
// releaseAllModifiers() immediately before rejecting on abort, as an
// explicit belt-and-suspenders measure: an unattended host must never be
// left with a stuck modifier, and this makes that guarantee independent of
// keyChord's own internal handling rather than relying on it alone.

const { keyChord, releaseAllModifiers } = require('../keyboard');
const addon = require('../addon');

function sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeAbortError() {
    const err = new Error('runKeystrokePlan aborted');
    err.name = 'AbortError';
    return err;
}

/**
 * Walk a keystroke plan, dispatching each atom by kind.
 *
 * @param {Array<
 *   {kind:'chord', key:string, modifiers:string[], preDelayMs:number, holdMs:number} |
 *   {kind:'char', codepoint:number, preDelayMs:number}
 * >} plan
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - sole cancellation channel; checked
 *   before each atom. On abort, releaseAllModifiers() is called before the
 *   returned Promise rejects with an AbortError.
 * @returns {Promise<void>} resolves on normal completion.
 */
async function runKeystrokePlan(plan, options = {}) {
    const { signal } = options;

    if (!Array.isArray(plan) || plan.length === 0) {
        return;
    }

    for (const atom of plan) {
        await sleep(atom.preDelayMs);

        if (signal && signal.aborted) {
            releaseAllModifiers();
            throw makeAbortError();
        }

        if (atom.kind === 'chord') {
            await keyChord(atom.modifiers, atom.key, { holdMs: atom.holdMs });
        } else if (atom.kind === 'char') {
            addon.typeChar(atom.codepoint);
        } else {
            throw new Error(`runKeystrokePlan: unknown atom kind '${atom.kind}'`);
        }
    }
}

module.exports = { runKeystrokePlan };
