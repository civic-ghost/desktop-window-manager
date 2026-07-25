'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  route_executor.js — plotRoute, the sole route executor (spec §10.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// plotRoute(route, options) walks a route produced by any path provider
// (linearPath, bezierPath, or a future drop-in) and injects it via the native
// setCursorPosition primitive. It is provider-agnostic: it neither knows nor
// cares how the route was generated, only that each point is
// { x, y, delayMs }.
//
// Cancellation: options.signal (an AbortSignal) is the sole control channel.
// Per spec §10.3, the signal is checked before each point injection — a
// point's delayMs sleep is not itself interruptible; the check happens once,
// immediately before setCursorPosition is called for that point. On abort,
// the executor stops and rejects with an AbortError. Normal completion is the
// resolved Promise; there is no separate completion callback.
// ─────────────────────────────────────────────────────────────────────────────

const addon = require('../addon');

function sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeAbortError() {
    const err = new Error('plotRoute aborted');
    err.name = 'AbortError';
    return err;
}

/**
 * Inject a route by walking it point-by-point via setCursorPosition.
 *
 * @param {Array<{x:number, y:number, delayMs:number}>} route
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - sole cancellation channel; checked
 *   before each point's injection.
 * @returns {Promise<void>} resolves on normal completion; rejects with an
 *   AbortError if aborted mid-route.
 */
async function plotRoute(route, options = {}) {
    const { signal } = options;

    if (!Array.isArray(route) || route.length === 0) {
        return;
    }

    for (const point of route) {
        await sleep(point.delayMs);

        if (signal && signal.aborted) {
            throw makeAbortError();
        }

        addon.setCursorPosition(point.x, point.y);
    }
}

module.exports = { plotRoute };
