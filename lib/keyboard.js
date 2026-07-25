'use strict';

// lib/keyboard.js — Keyboard composition layer (spec §9).
//
// tapKey, keyChord, releaseAllModifiers, and typeText. The keystroke-plan
// machinery typeText depends on (compiler, builders, executor) lives under
// lib/keystroke/ and is required lazily inside typeText — see the note on
// that function for why (a circular require with plan_executor.js).

const addon = require('./addon');
const { isValidKeyName } = require('./keys');

function sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Press `key` down, hold it for `holdMs`, then release it — guaranteeing the
 * keyUp fires even if the hold's sleep is somehow interrupted. Shared by
 * tapKey and keyChord so the two agree on identical holdMs semantics.
 *
 * @param {string} key
 * @param {number} holdMs
 * @returns {Promise<void>}
 */
async function pressWithHold(key, holdMs) {
    addon.keyDown(key);
    try {
        if (holdMs > 0) {
            await sleep(holdMs);
        }
    } finally {
        addon.keyUp(key);
    }
}

/**
 * Press and release a single key: keyDown(key) then keyUp(key).
 *
 * @param {string} key  A key name from the key enum (spec §12).
 * @param {Object} [options]
 * @param {number} [options.holdMs=0]  Dwell time between the down and up
 *   events. `0` (default) means back-to-back — down immediately followed by
 *   up. Same semantics as `holdMs` on keyChord and on chord-kind keystroke
 *   plan atoms.
 * @returns {Promise<void>}
 */
async function tapKey(key, options = {}) {
    if (!isValidKeyName(key)) {
        throw new TypeError(`tapKey: invalid key name '${key}'`);
    }
    const { holdMs = 0 } = options;
    await pressWithHold(key, holdMs);
}

/**
 * Press a sequence of modifiers, tap (or hold) a key, then release the
 * modifiers in reverse order. General form for F5, Ctrl+F5, Ctrl+Shift+Esc,
 * Alt+F4, etc.
 *
 * Reverse-order release is part of the contract (spec §9). Additionally —
 * beyond what the spec states explicitly for this function, but in the same
 * spirit as the plan executor's abort safety in §11.3 — every keyDown here is
 * paired with a guaranteed keyUp via try/finally, so a native-layer error
 * mid-chord (e.g. after a modifier is down but before the main key is
 * pressed) still releases whatever was actually pressed, in reverse order,
 * rather than leaving a modifier stuck down. Key-name validation happens
 * up front, before anything is pressed, so a bad name never presses anything
 * in the first place.
 *
 * @param {string[]} modifiers  Modifier key names, in press order (e.g. ['control', 'shift']).
 * @param {string} key          The main key name.
 * @param {Object} [options]
 * @param {number} [options.holdMs=0]  Dwell time between the main key's down and up.
 *   0 (default) presses and releases immediately, like tapKey.
 * @returns {Promise<void>}
 */
async function keyChord(modifiers, key, options = {}) {
    const mods = modifiers || [];
    const { holdMs = 0 } = options;

    for (const mod of mods) {
        if (!isValidKeyName(mod)) {
            throw new TypeError(`keyChord: invalid modifier key name '${mod}'`);
        }
    }
    if (!isValidKeyName(key)) {
        throw new TypeError(`keyChord: invalid key name '${key}'`);
    }

    const pressed = [];
    try {
        for (const mod of mods) {
            addon.keyDown(mod);
            pressed.push(mod);
        }

        await pressWithHold(key, holdMs);
    } finally {
        for (let i = pressed.length - 1; i >= 0; i--) {
            addon.keyUp(pressed[i]);
        }
    }
}

/**
 * Force-release every known modifier key. Panic / recovery primitive for
 * unattended use, wrapping the native safeguard directly.
 *
 * @returns {boolean}
 */
function releaseAllModifiers() {
    return addon.releaseAllModifiers();
}

/**
 * One-shot convenience: compile `text` with the default (linear) builder and
 * run the resulting plan. Equal to
 * `runKeystrokePlan(makeLinearKeystrokePlan(text, options), options)` (spec §9).
 *
 * The same `options` object is passed to both the builder and the executor —
 * the builder reads `charDelay`/`holdMs` and ignores `signal`; the executor
 * reads `signal` and ignores the timing options. This is not a conflict,
 * just two functions each picking out the keys they care about.
 *
 * NOTE on requires: lib/keystroke/plan_executor.js requires THIS file (for
 * keyChord/releaseAllModifiers), so requiring plan_executor.js back at this
 * file's top level would create a circular require — whichever module
 * finishes loading second would capture an incomplete reference to the
 * other. Requiring both keystroke-plan modules lazily, here inside the
 * function body, sidesteps that entirely: by the time typeText() is called,
 * both modules have already fully loaded (regardless of which was required
 * first), so these are just ordinary cached-module lookups.
 *
 * @param {string} text
 * @param {Object} [options]  See makeLinearKeystrokePlan (charDelay, holdMs)
 *   and runKeystrokePlan (signal).
 * @returns {Promise<void>}
 */
async function typeText(text, options = {}) {
    const { makeLinearKeystrokePlan } = require('./keystroke/linear_plan');
    const { runKeystrokePlan } = require('./keystroke/plan_executor');

    const plan = makeLinearKeystrokePlan(text, options);
    return runKeystrokePlan(plan, options);
}

module.exports = {
    tapKey,
    keyChord,
    releaseAllModifiers,
    typeText,
};
