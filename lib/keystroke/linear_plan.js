'use strict';

// lib/keystroke/linear_plan.js — makeLinearKeystrokePlan (spec §11.2, default builder).
//
// Compiles text via the shared compiler (lib/keystroke/compiler.js) and
// layers even timing on top: a constant preDelayMs on every atom after the
// first, and a constant holdMs on every chord atom. The first atom's
// preDelayMs is always 0 (spec's shared first-atom rule, §11.2) so a plan
// doesn't sit idle before its first keystroke.

const { compileText } = require('./compiler');

/**
 * Build a keystroke plan with even (linear) timing.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {number} [options.charDelay=0]  Constant preDelayMs written on every
 *   atom after the first. Default 0 means "type as fast as the loop runs."
 * @param {number} [options.holdMs=0]  Static dwell written on every chord
 *   atom (down-to-up time for the main key). Not applied to char atoms,
 *   which have no physical key being held.
 * @returns {Array<
 *   {kind:'chord', key:string, modifiers:string[], preDelayMs:number, holdMs:number} |
 *   {kind:'char', codepoint:number, preDelayMs:number}
 * >} the keystroke plan
 */
function makeLinearKeystrokePlan(text, options = {}) {
    const { charDelay = 0, holdMs = 0 } = options;

    const atoms = compileText(text);

    return atoms.map((atom, index) => {
        const preDelayMs = index === 0 ? 0 : charDelay;

        if (atom.kind === 'chord') {
            return {
                kind: 'chord',
                key: atom.key,
                modifiers: atom.modifiers,
                preDelayMs,
                holdMs,
            };
        }

        return {
            kind: 'char',
            codepoint: atom.codepoint,
            preDelayMs,
        };
    });
}

module.exports = { makeLinearKeystrokePlan };
