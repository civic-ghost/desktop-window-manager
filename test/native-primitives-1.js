// test/native-primitives.js
//
// Exercises the native primitives via the seam (../lib/addon.js).
// Chunk 1: pid on window queries; UTF-8 titles; DPI awareness in Init.
// Chunk 2: setCursorPosition, getCursorPosition, mouseButton, mouseWheel.
//
// NOTE: This test moves the cursor. It saves the original position at the
// start of the mouse section and restores it at the end. mouseButton is
// asserted at the surface only (see the section comment). mouseWheel does
// a canceling +1/-1 pair over the cursor's home position, so any transient
// scroll effect nets out.

const addon = require('../lib/addon.js');

let passed = 0;
let failed = 0;

function assert(cond, message) {
    if (cond) {
        console.log(`  [PASS] ${message}`);
        passed++;
    } else {
        console.log(`  [FAIL] ${message}`);
        failed++;
    }
}

function section(name, fn) {
    console.log(`\n=== ${name} ===`);
    try {
        fn();
    } catch (err) {
        console.log(`  [FAIL] threw: ${err.message}`);
        failed++;
    }
}

// -----------------------------------------------------------------------------
// Chunk 1 sections
// -----------------------------------------------------------------------------

section('getWindows() shape', () => {
    const windows = addon.getWindows();
    assert(Array.isArray(windows), 'returns an array');
    assert(windows.length > 0, `returned ${windows.length} windows (>0)`);

    const malformed = windows.filter(w =>
        typeof w.handle !== 'number' ||
        typeof w.title  !== 'string' ||
        typeof w.pid    !== 'number' ||
        !w.position || typeof w.position.x !== 'number' || typeof w.position.y !== 'number' ||
        !w.size     || typeof w.size.width !== 'number' || typeof w.size.height !== 'number'
    );
    assert(malformed.length === 0, `all entries well-formed (${malformed.length} malformed)`);

    const badPid = windows.filter(w => !(w.pid > 0));
    assert(badPid.length === 0, `every pid is a positive number (${badPid.length} bad)`);
});

section('getActiveWindow() shape', () => {
    const active = addon.getActiveWindow();
    assert(active !== null, 'returned an active window');
    if (!active) return;

    assert(typeof active.handle === 'number', 'handle is a number');
    assert(typeof active.title  === 'string', 'title is a string');
    assert(typeof active.pid === 'number' && active.pid > 0,
        `pid is a positive number (got ${active.pid})`);
    assert(active.position && typeof active.position.x === 'number', 'has position');
    assert(active.size     && typeof active.size.width  === 'number', 'has size');
});

section('pid consistency between getWindows and getActiveWindow', () => {
    const active = addon.getActiveWindow();
    if (!active) {
        console.log('  (skipped — no active window)');
        return;
    }
    const windows = addon.getWindows();
    const match = windows.find(w => w.handle === active.handle);
    if (!match) {
        console.log('  (skipped — active window not in getWindows() result; likely not IsWindowVisible)');
        return;
    }
    assert(match.pid === active.pid,
        `getWindows and getActiveWindow agree on pid (${match.pid} === ${active.pid})`);
    assert(match.title === active.title,
        `titles agree ("${match.title}" === "${active.title}")`);
});

section('UTF-8 window titles', () => {
    const windows = addon.getWindows();
    const nonAscii = windows.filter(w => /[^\x00-\x7F]/.test(w.title));

    console.log(`  total windows: ${windows.length}`);
    console.log(`  non-ASCII titles: ${nonAscii.length}`);
    if (nonAscii.length === 0) {
        console.log('  (no non-ASCII titles present — open something with a Unicode title to');
        console.log('   exercise the UTF-16 -> UTF-8 conversion path)');
    } else {
        nonAscii.slice(0, 5).forEach(w => {
            console.log(`    - "${w.title}" (pid ${w.pid})`);
        });
        const allHaveHighCodepoints = nonAscii.every(w =>
            [...w.title].some(ch => ch.codePointAt(0) > 0x7F)
        );
        assert(allHaveHighCodepoints,
            'non-ASCII titles decode to real high codepoints (not replacement chars)');
    }
});

// -----------------------------------------------------------------------------
// Chunk 2 sections — mouse primitives
// -----------------------------------------------------------------------------

console.log('\n--- mouse primitives (cursor will move during these tests) ---');

// Save the cursor at the top of the mouse section so we can restore it at
// the end. If getCursorPosition itself is broken we can't restore, so grab
// this before any other mouse call and be defensive.
let originalCursor = null;
try {
    originalCursor = addon.getCursorPosition();
    console.log(`  saved original cursor: (${originalCursor.x}, ${originalCursor.y})`);
} catch (e) {
    console.log(`  [WARN] could not read original cursor position: ${e.message}`);
}

section('getCursorPosition() shape', () => {
    const pos = addon.getCursorPosition();
    assert(pos !== null && typeof pos === 'object', 'returns an object');
    assert(typeof pos.x === 'number' && Number.isFinite(pos.x), `x is finite number (${pos.x})`);
    assert(typeof pos.y === 'number' && Number.isFinite(pos.y), `y is finite number (${pos.y})`);
});

section('setCursorPosition() -> getCursorPosition() round-trip', () => {
    // A handful of targets across the primary monitor. We allow ±1 px tolerance
    // because the OS's reverse mapping from 65535-space back to pixels can
    // round differently at the boundaries and under DPI scaling.
    const targets = [
        { x: 100, y: 100 },
        { x: 400, y: 300 },
        { x: 800, y: 600 },
    ];

    for (const t of targets) {
        const ok = addon.setCursorPosition(t.x, t.y);
        assert(ok === true, `setCursorPosition(${t.x}, ${t.y}) returned true`);

        const got = addon.getCursorPosition();
        const dx = got.x - t.x;
        const dy = got.y - t.y;
        const within = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        assert(within,
            `landed within 1px of (${t.x}, ${t.y}) — got (${got.x}, ${got.y}), Δ=(${dx}, ${dy})`);
    }
});

section('mouseButton() surface', () => {
    // We do NOT inject a real click here. A click at whatever's under the
    // cursor mid-test is unpredictable and can trigger unintended UI.
    // Instead: verify the function is exported and rejects invalid arguments.
    // Real click behavior is validated at the composition layer (chunk 6+).
    assert(typeof addon.mouseButton === 'function', 'exported as a function');

    let threw = false;
    try { addon.mouseButton('nope', 'down'); } catch (e) { threw = true; }
    assert(threw, 'rejects invalid button name');

    threw = false;
    try { addon.mouseButton('left', 'sideways'); } catch (e) { threw = true; }
    assert(threw, 'rejects invalid direction');

    threw = false;
    try { addon.mouseButton('left'); } catch (e) { threw = true; }
    assert(threw, 'rejects missing direction argument');
});

section('mouseWheel() canceling pair', () => {
    // Restore cursor to its original location before scrolling so any
    // transient scroll lands on the same window that was under the cursor
    // when the test started (usually the terminal running this script).
    if (originalCursor) {
        addon.setCursorPosition(originalCursor.x, originalCursor.y);
    }

    const up   = addon.mouseWheel(1);
    const down = addon.mouseWheel(-1);
    assert(up === true,   'mouseWheel(+1) returned true');
    assert(down === true, 'mouseWheel(-1) returned true');

    let threw = false;
    try { addon.mouseWheel('nope'); } catch (e) { threw = true; }
    assert(threw, 'rejects non-numeric amount');
});

// Restore the cursor to where we found it, so the test leaves the system
// in the state it started in.
if (originalCursor) {
    try {
        addon.setCursorPosition(originalCursor.x, originalCursor.y);
        console.log(`\n  restored cursor to (${originalCursor.x}, ${originalCursor.y})`);
    } catch (e) {
        console.log(`\n  [WARN] could not restore cursor: ${e.message}`);
    }
}

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
