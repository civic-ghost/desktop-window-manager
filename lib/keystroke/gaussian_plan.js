'use strict';

// lib/keystroke/gaussian_plan.js — makeGaussianKeystrokePlan (spec §11.2).
//
// Reproduces the timing approach from the current nutty.js typeText: each
// inter-character gap is an independent draw from a normal distribution via
// the Box-Muller transform. nutty.js applies this as a POST-delay (type the
// char, then sleep before the next one); our plan contract uses preDelayMs
// (spec §11.1), so the same i.i.d. samples are applied one position later —
// atom 0 gets preDelayMs = 0 (matching both nutty.js's immediate first
// keystroke and the plan builders' shared first-atom rule, §11.2), and every
// atom after that draws its own fresh sample. The distribution and clamping
// are otherwise a direct port of nutty.js's gaussianSample/MIN_DELAY_MS.

const { compileText } = require('./compiler');

/**
 * Box-Muller transform — one sample from N(mean, stdDev). Ported directly
 * from nutty.js's typeText: u1 = 1 - Math.random() (excludes 0, avoiding
 * log(0)), cosine variant, one sample per call (the paired sine sample is
 * not reused/cached, matching the original).
 *
 * @param {number} mean
 * @param {number} stdDev
 * @returns {number}
 */
function gaussianSample(mean, stdDev) {
    const u1 = 1 - Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z * stdDev;
}

/**
 * Build a keystroke plan with Gaussian-distributed inter-character timing.
 *
 * @param {string} text
 * @param {Object} options
 * @param {number} options.charDelay      Mean of the pre-delay distribution (ms).
 * @param {number} options.charDelaySTD   Standard deviation (ms). Negative
 *   values are clamped to 0, matching nutty.js's `Math.max(0, charDelaySTD)`.
 * @param {number} [options.minPreDelayMs=10]  Lower clamp applied to every
 *   sampled delay, so the Gaussian's negative tail can't produce a zero or
 *   negative sleep. Matches nutty.js's MIN_DELAY_MS default of 10.
 * @param {number} [options.holdMs=0]  Static dwell written on every chord
 *   atom, same semantics as the linear builder. Not Gaussian-distributed in
 *   v1 — only the inter-character gap varies.
 * @returns {Array<
 *   {kind:'chord', key:string, modifiers:string[], preDelayMs:number, holdMs:number} |
 *   {kind:'char', codepoint:number, preDelayMs:number}
 * >} the keystroke plan
 */
function makeGaussianKeystrokePlan(text, options = {}) {
    const {
        charDelay,
        charDelaySTD,
        minPreDelayMs = 10,
        holdMs = 0,
    } = options;

    const std = Math.max(0, charDelaySTD);
    const atoms = compileText(text);

    return atoms.map((atom, index) => {
        const preDelayMs = index === 0
            ? 0
            : Math.max(minPreDelayMs, gaussianSample(charDelay, std));

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

module.exports = { makeGaussianKeystrokePlan };
