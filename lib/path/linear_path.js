'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  linear_path.js — default mouse-path provider (spec §10.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// A "path provider" is a pure function of the form:
//
//     (from, to, options) -> route
//
// where a `route` is a flat array of `{ x, y, delayMs }` points (spec §10.1).
// This is the simplest possible provider: a straight line at constant speed,
// resampled into evenly time-spaced points. No OS, native, or browser
// dependency — same contract as bezier_path.js, so the two are interchangeable
// at the executor.
// ─────────────────────────────────────────────────────────────────────────────

function magnitude(dx, dy) {
    return Math.hypot(dx, dy);
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

/**
 * Generate a straight-line cursor route from `from` to `to`, resampled in
 * time at a constant speed.
 *
 * @param {{x:number,y:number}} from - start pixel coordinate
 * @param {{x:number,y:number}} to   - target pixel coordinate
 * @param {Object} [options]
 * @param {number} [options.speedPxPerMs=1.5] - constant speed; duration scales
 *   with distance (chord / speed).
 * @param {number} [options.frameMs=12]       - target ms between points.
 * @param {number} [options.minDurationMs=30] - clamp floor for total time, so
 *   very short moves still get at least one intermediate point.
 * @param {number} [options.maxDurationMs=2000] - clamp ceiling for total time.
 *
 * @returns {Array<{x:number, y:number, delayMs:number}>} the route
 */
function linearPath(from, to, options = {}) {
    const {
        speedPxPerMs   = 1.5,
        frameMs        = 12,
        minDurationMs  = 30,
        maxDurationMs  = 2000,
    } = options;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = magnitude(dx, dy);

    const duration = clamp(distance / speedPxPerMs, minDurationMs, maxDurationMs);

    const N = clamp(Math.round(duration / frameMs), 1, 500);
    const nominalStep = duration / N;

    const points = [];
    for (let k = 0; k <= N; k++) {
        const t = k / N;
        points.push({
            x: Math.round(from.x + dx * t),
            y: Math.round(from.y + dy * t),
            delayMs: Math.round(nominalStep),
        });
    }

    // First point is where the cursor already is (spec §10.1): no pre-delay,
    // pinned exactly to `from` to avoid a rounding-induced hop.
    points[0].delayMs = 0;
    points[0].x = Math.round(from.x);
    points[0].y = Math.round(from.y);

    // Last point pinned exactly to `to`.
    if (points.length > 1) {
        points[points.length - 1].x = Math.round(to.x);
        points[points.length - 1].y = Math.round(to.y);
    }

    return points;
}

module.exports = { linearPath };
