'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  bezier_path.js — humanized mouse-path provider  (clean-room implementation)
// ─────────────────────────────────────────────────────────────────────────────
//
// A "path provider" is a pure function of the form:
//
//     (from, to, options) -> route
//
// where a `route` is a flat array of `{ x, y, delayMs }` points. `x`/`y` are
// pixel coordinates; `delayMs` is how long the plotter should pause *before*
// injecting that point. The provider has ZERO dependency on the OS, the native
// addon, or any browser — it just does the geometry and timing. The plotter
// (elsewhere) walks the route and injects each point via the native addon.
//
// This module has no external dependencies. Cubic Béziers are evaluated
// directly; there is no bezier-js.
//
// CREDIT / ATTRIBUTION
// --------------------
// The curve *math* here (vector ops, cubic Bézier evaluation, Fitts-style
// timing) is standard and was written from scratch. Two design ideas were
// taken from Xetera's ghost-cursor (MIT, https://github.com/Xetera/ghost-cursor)
// after reviewing its source, and are reimplemented here in our own code:
//
//   1. Both Bézier control points are placed on the SAME side of the chord,
//      so the curve bows once instead of forming a wobbly S. (ghost-cursor:
//      generateBezierAnchors — a single random `side` shared by both anchors.)
//   2. Overshoot targets a point sampled uniformly from a disk around the real
//      target (radius * sqrt(random) for area-uniformity). (ghost-cursor:
//      overshoot.)
//
// Everything else is our own.
// ─────────────────────────────────────────────────────────────────────────────


// ── Vector helpers ───────────────────────────────────────────────────────────

function sub(a, b)        { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a, b)        { return { x: a.x + b.x, y: a.y + b.y }; }
function scaleVec(a, k)   { return { x: a.x * k,   y: a.y * k   }; }
function magnitude(a)     { return Math.hypot(a.x, a.y); }
function lerp(a, b, t)    { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/**
 * Unit-length perpendicular to the direction a->b. Rotating (dx,dy) by 90°
 * yields (dy,-dx); we normalize so callers scale by an explicit magnitude.
 * Falls back to (0,0)'s guard when a and b coincide.
 */
function unitPerpendicular(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dy / len, y: -dx / len };
}


// ── Randomness ───────────────────────────────────────────────────────────────

function rand(min, max) { return min + Math.random() * (max - min); }

/**
 * A point sampled uniformly from a disk of the given radius, centered on the
 * origin. The sqrt on the radius is what makes it *area*-uniform — sampling the
 * radius linearly would bunch samples toward the center.  [idea: ghost-cursor]
 */
function randomInDisk(radius) {
    const angle = Math.random() * 2 * Math.PI;
    const r = radius * Math.sqrt(Math.random());
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}


// ── Curve construction ───────────────────────────────────────────────────────

/**
 * Two cubic-Bézier control points for the chord p0->p3, both offset to the
 * SAME side of the chord so the curve bows once rather than snaking.
 * [idea: ghost-cursor — a single shared `side`]
 *
 * Each control point sits at a random position along the chord, pushed
 * perpendicular by a random fraction (minCurveFraction..1) of `spread`.
 */
function controlPoints(p0, p3, spread, minCurveFraction) {
    const side = Math.random() < 0.5 ? -1 : 1;   // chosen once, shared by both
    const perp = unitPerpendicular(p0, p3);

    const makeAnchor = () => {
        const base   = lerp(p0, p3, Math.random());
        const offset = rand(spread * minCurveFraction, spread) * side;
        return add(base, scaleVec(perp, offset));
    };

    // Order the two anchors along the chord direction so the curve does not
    // fold back on itself. (Projection onto the chord is direction-agnostic,
    // unlike ghost-cursor's sort-by-x which degrades on vertical moves.)
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const along = (p) => p.x * dx + p.y * dy;

    const c1 = makeAnchor();
    const c2 = makeAnchor();
    return along(c1) <= along(c2) ? [c1, c2] : [c2, c1];
}

/** Evaluate a cubic Bézier at parameter t in [0,1]. */
function cubicAt(p0, c1, c2, p3, t) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
        x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
        y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
    };
}

/** Densely sample one cubic into `steps + 1` points (inclusive of both ends). */
function sampleCubic(p0, c1, c2, p3, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        pts.push(cubicAt(p0, c1, c2, p3, i / steps));
    }
    return pts;
}


// ── Timing ───────────────────────────────────────────────────────────────────

/**
 * Smootherstep (Perlin): 6t^5 - 15t^4 + 10t^3. Zero first AND second
 * derivative at both ends, so the cursor eases out of rest and into the target
 * with no velocity discontinuity — this is what produces the accel/decel feel.
 */
function easeInOut(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Position at arc-length `dist` along a sampled polyline, via binary search on
 * the cumulative-length table plus a segment lerp.
 */
function pointAtDistance(pts, cumulative, dist) {
    const total = cumulative[cumulative.length - 1];
    if (dist <= 0)     return pts[0];
    if (dist >= total) return pts[pts.length - 1];

    let lo = 1;
    let hi = cumulative.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < dist) lo = mid + 1;
        else hi = mid;
    }
    const segLen = (cumulative[lo] - cumulative[lo - 1]) || 1;
    const f = (dist - cumulative[lo - 1]) / segLen;
    return lerp(pts[lo - 1], pts[lo], f);
}


// ── Public provider ──────────────────────────────────────────────────────────

/**
 * Generate a humanized cursor route from `from` to `to`.
 *
 * @param {{x:number,y:number}} from - start pixel coordinate
 * @param {{x:number,y:number}} to   - target pixel coordinate
 * @param {Object} [options]
 * @param {number}  [options.minSpread=2]           - min perpendicular bow (px)
 * @param {number}  [options.maxSpread=160]         - max perpendicular bow (px)
 * @param {number}  [options.minCurveFraction=0.2]  - min bow as fraction of spread
 * @param {boolean} [options.overshoot=true]        - overshoot + correct on long moves
 * @param {number}  [options.overshootThreshold=300]- min chord length (px) to overshoot
 * @param {number}  [options.overshootRadius=40]    - overshoot disk radius (px)
 * @param {number}  [options.baseDurationMs=80]     - Fitts intercept (ms)
 * @param {number}  [options.durationPerBitMs=42]   - Fitts slope (ms per bit)
 * @param {number}  [options.minDurationMs=90]      - clamp floor for total time
 * @param {number}  [options.maxDurationMs=1100]    - clamp ceiling for total time
 * @param {number}  [options.frameMs=12]            - target ms between points
 * @param {number}  [options.minPointDelayMs=6]     - clamp floor for a point's delay
 * @param {number}  [options.timingJitter=0.25]     - ± fraction jitter on each delay
 *
 * @returns {Array<{x:number, y:number, delayMs:number}>} the route
 */
function bezierPath(from, to, options = {}) {
    const {
        minSpread          = 2,
        maxSpread          = 160,
        minCurveFraction   = 0.2,
        overshoot          = true,
        overshootThreshold = 300,
        overshootRadius    = 40,
        baseDurationMs     = 80,
        durationPerBitMs   = 42,
        minDurationMs      = 90,
        maxDurationMs      = 1100,
        frameMs            = 12,
        minPointDelayMs    = 6,
        timingJitter       = 0.25,
    } = options;

    // 1. GEOMETRY ─ build a dense raw polyline (main curve, plus a short
    //    correction curve if we overshoot).
    const chord = magnitude(sub(to, from));

    // When overshooting, `target` is a fresh object offset from `to`; otherwise
    // it IS `to` (same reference), which the correction-curve check relies on.
    const target = (overshoot && chord > overshootThreshold)
        ? add(to, randomInDisk(overshootRadius))
        : to;

    const raw = [];

    {   // main curve: from -> target
        const spread    = clamp(chord, minSpread, maxSpread);
        const [c1, c2]  = controlPoints(from, target, spread, minCurveFraction);
        const steps     = clamp(Math.round(chord / 6), 24, 240);
        raw.push(...sampleCubic(from, c1, c2, target, steps));
    }

    if (target !== to) {   // correction curve: target -> real to (short, gentle)
        const corrChord = magnitude(sub(to, target));
        const spread    = clamp(corrChord, minSpread, maxSpread * 0.25);
        const [c1, c2]  = controlPoints(target, to, spread, minCurveFraction);
        const steps     = clamp(Math.round(corrChord / 4), 8, 60);
        // drop index 0: it duplicates the last point of the main curve
        raw.push(...sampleCubic(target, c1, c2, to, steps).slice(1));
    }

    // 2. ARC-LENGTH TABLE over the raw polyline.
    const cumulative = [0];
    for (let i = 1; i < raw.length; i++) {
        cumulative.push(cumulative[i - 1] + magnitude(sub(raw[i], raw[i - 1])));
    }
    const totalLength = cumulative[cumulative.length - 1] || 1;

    // 3. DURATION ─ Fitts-inspired. With no target width in a from->to
    //    contract, we approximate the index of difficulty from distance alone;
    //    the log means long moves are only modestly slower than short ones,
    //    which is itself Fitts-realistic.
    const difficulty = Math.log2(totalLength + 1);
    const duration = clamp(
        baseDurationMs + durationPerBitMs * difficulty,
        minDurationMs,
        maxDurationMs,
    );

    // 4. RESAMPLE in EASED TIME. Step uniformly through normalized time, ease
    //    it to an arc-length fraction, and read the position there. Equal time
    //    per step + unequal spatial spacing == acceleration then deceleration,
    //    without ever needing the curve's speed function.
    const N = clamp(Math.round(duration / frameMs), 12, 400);
    const nominalStep = duration / N;   // constant slice of time per step
    const points = [];

    for (let k = 0; k <= N; k++) {
        const tau = k / N;                          // uniform in time
        const s   = easeInOut(tau) * totalLength;   // eased distance
        const pos = pointAtDistance(raw, cumulative, s);

        let delayMs = nominalStep * (1 + rand(-timingJitter, timingJitter));
        delayMs = Math.max(minPointDelayMs, Math.round(delayMs));

        points.push({ x: Math.round(pos.x), y: Math.round(pos.y), delayMs });
    }

    // The first point is where the cursor already is; no pre-delay, and pin it
    // exactly to `from` to avoid a rounding-induced hop on the first injection.
    if (points.length) {
        points[0].delayMs = 0;
        points[0].x = Math.round(from.x);
        points[0].y = Math.round(from.y);
    }
    // Guarantee the final point lands exactly on the requested target.
    if (points.length > 1) {
        points[points.length - 1].x = Math.round(to.x);
        points[points.length - 1].y = Math.round(to.y);
    }

    return points;
}

module.exports = { bezierPath };
