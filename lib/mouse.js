'use strict';

// lib/mouse.js — Mouse composition layer (spec §9).

const addon = require('./addon');
const { linearPath } = require('./path/linear_path');
const { plotRoute } = require('./path/route_executor');

// Carried over from the current implementation (nutty.js), confirmed
// empirical and multiplicative: scrollAmount = Math.round(pixels * SCROLL_UNITS_PER_PIXEL).
// "Starting" factor per spec §9 — subject to adjustment against observed behavior.
const SCROLL_UNITS_PER_PIXEL = 1.4;

const VALID_BUTTONS = new Set(['left', 'right', 'middle']);

function assertValidButton(button) {
    if (!VALID_BUTTONS.has(button)) {
        throw new TypeError(`Invalid mouse button '${button}'. Expected 'left', 'right', or 'middle'.`);
    }
}

function sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Move the cursor to `to`, resolving the current position via
 * getCursorPosition(), building a route with the configured path provider
 * (default linearPath), and injecting it via plotRoute.
 *
 * @param {{x:number, y:number}} to
 * @param {Object} [options]
 * @param {Function} [options.provider=linearPath]  A path provider function
 *   conforming to the route contract (spec §10.2) — e.g. linearPath or
 *   bezierPath. Any drop-in provider works here.
 * @param {AbortSignal} [options.signal]  Passed through to plotRoute.
 * @param {...*} [options.*]  All remaining options are passed through
 *   unchanged to the provider (e.g. bezierPath's minSpread, overshoot, etc.).
 * @returns {Promise<void>}
 */
async function moveTo(to, options = {}) {
    const { provider = linearPath, signal, ...providerOptions } = options;
    const from = addon.getCursorPosition();
    const route = provider(from, to, providerOptions);
    return plotRoute(route, { signal });
}

// plotRoute is the sole route executor (§10) — re-exported here as part of
// the mouse composition surface, not reimplemented (see module.exports below).

// ---------------------------------------------------------------------------
// Buttons — primitives
// ---------------------------------------------------------------------------

/**
 * Press a mouse button down at the current cursor position.
 *
 * Callers composing their own press-and-release sequence from mouseDown/
 * mouseUp are responsible for guaranteeing the release themselves (e.g. a
 * try/finally around whatever runs in between) — this function does not do
 * that for you (spec §9). Guaranteed-release composition over a whole
 * lifecycle is the job of a higher-level operation, like the deferred
 * drag(from, to, options) (§2.3).
 *
 * @param {'left'|'right'|'middle'} [button='left']
 * @returns {void}
 */
function mouseDown(button = 'left') {
    assertValidButton(button);
    addon.mouseButton(button, 'down');
}

/**
 * Release a mouse button at the current cursor position. See mouseDown for
 * the release-safety note.
 *
 * @param {'left'|'right'|'middle'} [button='left']
 * @returns {void}
 */
function mouseUp(button = 'left') {
    assertValidButton(button);
    addon.mouseButton(button, 'up');
}

// ---------------------------------------------------------------------------
// Clicks — self-contained compositions
// ---------------------------------------------------------------------------

/**
 * Press and release a mouse button at the current cursor position.
 *
 * Unlike bare mouseDown/mouseUp, this is a single self-contained
 * composition, so — same rationale as tapKey/keyChord in lib/keyboard.js —
 * the release is guaranteed via try/finally even if something throws
 * between down and up. This does not conflict with mouseDown/mouseUp's own
 * "caller's responsibility" contract, which only applies when a caller
 * composes its own sequence directly from those two primitives.
 *
 * @param {'left'|'right'|'middle'} [button='left']
 * @param {Object} [options]
 * @param {number} [options.holdMs=0]  Dwell time between down and up. `0`
 *   (default) presses and releases back-to-back.
 * @returns {Promise<void>}
 */
async function click(button = 'left', options = {}) {
    assertValidButton(button);
    const { holdMs = 0 } = options;

    addon.mouseButton(button, 'down');
    try {
        if (holdMs > 0) {
            await sleep(holdMs);
        }
    } finally {
        addon.mouseButton(button, 'up');
    }
}

/**
 * Two clicks in quick succession, so the OS registers a double-click rather
 * than two separate single clicks.
 *
 * @param {'left'|'right'|'middle'} [button='left']
 * @param {Object} [options]
 * @param {number} [options.holdMs=0]  Dwell per individual click, as in click().
 * @param {number} [options.interClickDelay=80]  Gap between the two clicks (ms).
 *   NOTE: this default (80ms) is not specified by the spec — it's a
 *   reasonable placeholder pending real-world tuning, same spirit as
 *   linearPath's speedPxPerMs default. Adjust if it doesn't register
 *   reliably as a double-click on your target OS/apps.
 * @returns {Promise<void>}
 */
async function doubleClick(button = 'left', options = {}) {
    const { interClickDelay = 80 } = options;

    await click(button, options);
    await sleep(interClickDelay);
    await click(button, options);
}

/**
 * Three clicks in quick succession, so the OS registers a triple-click.
 * Same options as doubleClick.
 *
 * @param {'left'|'right'|'middle'} [button='left']
 * @param {Object} [options]
 * @param {number} [options.holdMs=0]
 * @param {number} [options.interClickDelay=80]
 * @returns {Promise<void>}
 */
async function tripleClick(button = 'left', options = {}) {
    const { interClickDelay = 80 } = options;

    await click(button, options);
    await sleep(interClickDelay);
    await click(button, options);
    await sleep(interClickDelay);
    await click(button, options);
}

/**
 * Move to `to`, then click. Move and click remain independently callable;
 * this is convenience only (spec §9).
 *
 * @param {{x:number, y:number}} to
 * @param {Object} [options]  Passed to moveTo (provider, signal, provider
 *   options) AND to click (button, holdMs). `options.button` selects the
 *   button (default 'left'), since clickAt has no separate button parameter.
 * @returns {Promise<void>}
 */
async function clickAt(to, options = {}) {
    await moveTo(to, options);
    const { button = 'left' } = options;
    return click(button, options);
}

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------

/**
 * Scroll by a signed pixel-ish amount. Positive scrolls up/away from the
 * user (matching the native mouseWheel primitive's convention); negative
 * scrolls down.
 *
 * Conversion: scrollAmount = Math.round(amount * SCROLL_UNITS_PER_PIXEL),
 * carried over from nutty.js's existing behavior.
 *
 * @param {number} amount
 * @returns {boolean}
 */
function scroll(amount) {
    const detents = Math.round(amount * SCROLL_UNITS_PER_PIXEL);
    return addon.mouseWheel(detents);
}

/**
 * Scroll up by `n` (magnitude only — sign is normalized internally).
 * @param {number} n
 * @returns {boolean}
 */
function scrollUp(n) {
    return scroll(Math.abs(n));
}

/**
 * Scroll down by `n` (magnitude only — sign is normalized internally).
 * @param {number} n
 * @returns {boolean}
 */
function scrollDown(n) {
    return scroll(-Math.abs(n));
}

module.exports = {
    moveTo,
    plotRoute,
    mouseDown,
    mouseUp,
    click,
    doubleClick,
    tripleClick,
    clickAt,
    scroll,
    scrollUp,
    scrollDown,
    SCROLL_UNITS_PER_PIXEL,
};
