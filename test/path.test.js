// test/path.test.js — manual test harness for the route contract (spec §10).
//
// Run from the test/ folder:
//   node path.test.js
//
// Same plain pass/fail style as screen.test.js. Two kinds of checks here:
//
//   1. Structural checks on linearPath/bezierPath — pure functions, no addon,
//      no display needed. These assert the §10.1 route contract itself:
//      first point pinned to `from` with delayMs 0, last point pinned to
//      `to`, every point numeric and well-formed.
//
//   2. Integration checks on plotRoute — these DO move the real cursor via
//      the native addon, and verify final position via getCursorPosition().
//      Includes a mid-route abort case, which is the one behavior that's
//      new and worth being paranoid about.
//
// Cursor is left at the last integration test's target when this finishes —
// nothing to clean up, unlike screen.test.js's throwaway Notepad.

const { linearPath } = require('../lib/path/linear_path');
const { bezierPath } = require('../lib/path/bezier_path');
const { plotRoute } = require('../lib/path/route_executor');
const screen = require('../lib/screen');

// setCursorPosition injects via SendInput's normalized 0..65535 absolute
// coordinate space (MOUSEEVENTF_ABSOLUTE), which has an inherent ~1px
// rounding quantization on the pixel -> normalized -> pixel round trip.
// Confirmed on real hardware (rock1/rock2, single fixed-resolution session):
// off by (-1,-1) even under otherwise-clean conditions. This is expected
// behavior of the native primitive, not a bug in plotRoute/linearPath/
// bezierPath — all of which correctly request the exact literal target
// pixel. ±2px gives a little headroom over the observed ±1px.
const CURSOR_TOLERANCE_PX = 2;

function isWithinTolerance(actual, target, tolerance = CURSOR_TOLERANCE_PX) {
    return Math.abs(actual.x - target.x) <= tolerance &&
        Math.abs(actual.y - target.y) <= tolerance;
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        console.log(`  PASS  ${label}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Structural checks — route contract (§10.1), no addon involved
// ---------------------------------------------------------------------------

function checkRouteShape(label, route, from, to) {
    check(`${label}: returns a non-empty array`, Array.isArray(route) && route.length > 0,
        `length=${route && route.length}`);

    if (!Array.isArray(route) || route.length === 0) return;

    const allWellFormed = route.every(p =>
        p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.delayMs === 'number');
    check(`${label}: every point has numeric {x, y, delayMs}`, allWellFormed,
        JSON.stringify(route.find(p =>
            !(p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.delayMs === 'number'))));

    const allNonNegativeDelay = route.every(p => p.delayMs >= 0);
    check(`${label}: no negative delayMs`, allNonNegativeDelay);

    const first = route[0];
    check(`${label}: first point pinned to 'from'`,
        first.x === from.x && first.y === from.y,
        `got (${first.x}, ${first.y}), expected (${from.x}, ${from.y})`);
    check(`${label}: first point has delayMs 0`, first.delayMs === 0, `delayMs=${first.delayMs}`);

    const last = route[route.length - 1];
    check(`${label}: last point pinned to 'to'`,
        last.x === to.x && last.y === to.y,
        `got (${last.x}, ${last.y}), expected (${to.x}, ${to.y})`);
}

function testLinearPathShape() {
    console.log('\nlinearPath() — route contract');
    const from = { x: 100, y: 100 };
    const to = { x: 500, y: 400 };
    const route = linearPath(from, to);
    checkRouteShape('linearPath', route, from, to);

    // Sanity: a longer move should take at least as many points as a short one.
    const shortRoute = linearPath({ x: 0, y: 0 }, { x: 10, y: 10 });
    const longRoute = linearPath({ x: 0, y: 0 }, { x: 2000, y: 2000 });
    check('linearPath: longer distance yields a duration-clamped, sane point count',
        longRoute.length >= shortRoute.length,
        `short=${shortRoute.length} long=${longRoute.length}`);

    // Zero-distance move: from === to. Should not throw, should still return
    // at least the pinned endpoints.
    const zeroRoute = linearPath({ x: 300, y: 300 }, { x: 300, y: 300 });
    checkRouteShape('linearPath (zero-distance)', zeroRoute, { x: 300, y: 300 }, { x: 300, y: 300 });
}

function testBezierPathShape() {
    console.log('\nbezierPath() — route contract');
    const from = { x: 100, y: 100 };
    const to = { x: 500, y: 400 };
    const route = bezierPath(from, to);
    checkRouteShape('bezierPath', route, from, to);

    // Bezier should curve — i.e. not every intermediate point lies exactly on
    // the straight chord from -> to. (Weak check: just confirm some deviation
    // exists somewhere in the middle of the route.)
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const chordLenSq = dx * dx + dy * dy;
    function distToChordSq(p) {
        if (chordLenSq === 0) return 0;
        const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / chordLenSq;
        const projX = from.x + t * dx;
        const projY = from.y + t * dy;
        const ex = p.x - projX;
        const ey = p.y - projY;
        return ex * ex + ey * ey;
    }
    const hasDeviation = route.some(p => distToChordSq(p) > 1); // >1px off the chord
    check('bezierPath: route deviates from the straight chord (actually curves)', hasDeviation);

    // Zero-distance move shouldn't throw either.
    const zeroRoute = bezierPath({ x: 300, y: 300 }, { x: 300, y: 300 });
    checkRouteShape('bezierPath (zero-distance)', zeroRoute, { x: 300, y: 300 }, { x: 300, y: 300 });
}

// ---------------------------------------------------------------------------
// Integration checks — plotRoute actually moves the real cursor
// ---------------------------------------------------------------------------

async function testPlotRouteLinear() {
    console.log('\nplotRoute() + linearPath — moves the real cursor');
    const from = screen.getCursorPosition();
    const to = { x: 400, y: 300 };

    await plotRoute(linearPath(from, to));
    await sleep(50);

    const finalPos = screen.getCursorPosition();
    check('cursor lands on target (within tolerance) after plotRoute(linearPath(...))',
        isWithinTolerance(finalPos, to),
        `got (${finalPos.x}, ${finalPos.y}), expected (${to.x}, ${to.y}) ±${CURSOR_TOLERANCE_PX}px`);
}

async function testPlotRouteBezier() {
    console.log('\nplotRoute() + bezierPath — moves the real cursor');
    const from = screen.getCursorPosition();
    const to = { x: 900, y: 600 };

    await plotRoute(bezierPath(from, to));
    await sleep(50);

    const finalPos = screen.getCursorPosition();
    check('cursor lands on target (within tolerance) after plotRoute(bezierPath(...))',
        isWithinTolerance(finalPos, to),
        `got (${finalPos.x}, ${finalPos.y}), expected (${to.x}, ${to.y}) ±${CURSOR_TOLERANCE_PX}px`);
}

async function testPlotRouteEmpty() {
    console.log('\nplotRoute() — empty route');
    let threw = false;
    try {
        await plotRoute([]);
    } catch (err) {
        threw = true;
    }
    check('plotRoute([]) resolves without throwing', !threw);
}

async function testPlotRouteAbort() {
    console.log('\nplotRoute() — mid-route abort via AbortSignal');

    const from = screen.getCursorPosition();
    // Long chord + slow speed to get a route close to linearPath's
    // maxDurationMs ceiling (2000ms by default), giving the abort plenty of
    // time to land mid-route rather than racing completion.
    const to = { x: from.x + 1000, y: from.y + 700 };
    const route = linearPath(from, to, { speedPxPerMs: 0.05 });

    const controller = new AbortController();
    const runPromise = plotRoute(route, { signal: controller.signal });

    setTimeout(() => controller.abort(), 300);

    let rejected = false;
    let errorName = null;
    try {
        await runPromise;
    } catch (err) {
        rejected = true;
        errorName = err.name;
    }

    check('plotRoute rejects when aborted mid-route', rejected);
    check('rejection is an AbortError', errorName === 'AbortError', `got name=${errorName}`);

    await sleep(50);
    const finalPos = screen.getCursorPosition();
    const reachedFullTarget = isWithinTolerance(finalPos, to);
    check('cursor did NOT reach the full target (route was actually cut short)',
        !reachedFullTarget,
        `cursor ended at (${finalPos.x}, ${finalPos.y}); target was (${to.x}, ${to.y})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== path/route contract test suite (spec §10) ===');

    testLinearPathShape();
    testBezierPathShape();
    await testPlotRouteLinear();
    await testPlotRouteBezier();
    await testPlotRouteEmpty();
    await testPlotRouteAbort();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('Unhandled error in test run:', err);
    process.exitCode = 1;
});
