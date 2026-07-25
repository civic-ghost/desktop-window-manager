// test/native-primitives.js
//
// Exercises the native primitives via the seam (../lib/addon.js).
// Chunk 1: pid on window queries; UTF-8 titles; DPI awareness in Init.
// Chunk 2: setCursorPosition, getCursorPosition, mouseButton, mouseWheel.
// Chunk 3: clipboardSetText/GetText round-trip; lib/keys.js enum surface;
//          keyboard round-trip via Notepad (types a known string, does
//          Ctrl+A + Ctrl+C via primitives, reads clipboard, compares).
//
// The Notepad round-trip is the interesting new piece — it needs a focused
// empty Notepad window during the 5-second countdown. See the section
// header for setup instructions.

const addon = require('../lib/addon.js');
const keys  = require('../lib/keys.js');

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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

if (originalCursor) {
    try {
        addon.setCursorPosition(originalCursor.x, originalCursor.y);
        console.log(`\n  restored cursor to (${originalCursor.x}, ${originalCursor.y})`);
    } catch (e) {
        console.log(`\n  [WARN] could not restore cursor: ${e.message}`);
    }
}

// -----------------------------------------------------------------------------
// Chunk 3 sections — keyboard, clipboard, key enum
// -----------------------------------------------------------------------------

section('lib/keys.js key enum surface', () => {
    // Expected sizes per spec §12 plus punctuation naming from chunk 3 setup:
    //   26 letters + 10 digits + 24 function + 12 modifiers
    // + 10 navigation + 5 editing + 16 numpad + 11 punctuation = 114
    const expected = 26 + 10 + 24 + 12 + 10 + 5 + 16 + 11;
    assert(keys.ALL.size === expected,
        `ALL contains ${keys.ALL.size} names (expected ${expected})`);

    // Spot checks across each category
    assert(keys.isValidKeyName('a'),            "'a' is valid");
    assert(keys.isValidKeyName('z'),            "'z' is valid");
    assert(keys.isValidKeyName('0'),            "'0' is valid");
    assert(keys.isValidKeyName('f12'),          "'f12' is valid");
    assert(keys.isValidKeyName('f24'),          "'f24' is valid");
    assert(keys.isValidKeyName('leftControl'),  "'leftControl' is valid");
    assert(keys.isValidKeyName('rightMeta'),    "'rightMeta' is valid");
    assert(keys.isValidKeyName('pageUp'),       "'pageUp' is valid");
    assert(keys.isValidKeyName('numEnter'),     "'numEnter' is valid");
    assert(keys.isValidKeyName('semicolon'),    "'semicolon' is valid");
    assert(keys.isValidKeyName('backtick'),     "'backtick' is valid");

    // Negative cases
    assert(!keys.isValidKeyName('foo'),         "'foo' is not valid");
    assert(!keys.isValidKeyName(''),            "empty string is not valid");
    assert(!keys.isValidKeyName('A'),           "uppercase 'A' is not valid (case is a shift modifier)");
    assert(!keys.isValidKeyName(42),            "non-string is not valid");
});

section('native keyDown/keyUp reject unknown names', () => {
    let threw = false;
    try { addon.keyDown('foo'); } catch (e) { threw = true; }
    assert(threw, "keyDown('foo') throws");

    threw = false;
    try { addon.keyUp('foo'); } catch (e) { threw = true; }
    assert(threw, "keyUp('foo') throws");

    threw = false;
    try { addon.keyDown(); } catch (e) { threw = true; }
    assert(threw, "keyDown() with no args throws");
});

section('clipboardSetText / clipboardGetText round-trip', () => {
    const testStrings = [
        'hello world',
        'ASCII punctuation: hello, world! (parens) [brackets] {braces} <angle>',
        'Non-ASCII: café résumé naïve',
        'CJK: 日本語 中文 한국어',
        'Emoji: 🎉 🚀 ✨',
        'Multi-line:\nfirst\nsecond\nthird',
    ];

    // Save original clipboard so we can restore at the end
    let original = '';
    try { original = addon.clipboardGetText(); } catch (e) { /* ignore */ }

    for (const str of testStrings) {
        const setOk = addon.clipboardSetText(str);
        const preview = str.slice(0, 30).replace(/\n/g, '\\n');
        assert(setOk === true, `set "${preview}${str.length > 30 ? '...' : ''}" ok`);

        const got = addon.clipboardGetText();
        assert(got === str,
            `round-trip matches (got ${got.length} chars, expected ${str.length})`);
    }

    // Restore
    if (original) {
        try { addon.clipboardSetText(original); } catch (e) { /* ignore */ }
    }
});

// -----------------------------------------------------------------------------
// Async: Notepad round-trip
// -----------------------------------------------------------------------------

async function keyboardNotepadRoundTrip() {
    console.log('\n=== keyboard round-trip via Notepad ===');
    console.log('Setup:');
    console.log('  1. Open a NEW, empty Notepad window (Start -> "Notepad")');
    console.log('  2. Click into the text area so it is focused');
    console.log('  3. Leave it focused — the test will not switch windows for you');
    console.log('');
    console.log('The test will:');
    console.log('  - wait 5 seconds so you can focus Notepad');
    console.log('  - verify the active window looks like Notepad');
    console.log('  - type a known string via native primitives');
    console.log('  - Ctrl+A / Ctrl+C via raw keyDown / keyUp');
    console.log('  - read the clipboard and compare');
    console.log('');
    console.log('Press Ctrl+C now to skip.');

    for (let i = 5; i > 0; i--) {
        process.stdout.write(`\r  focus Notepad — starting in ${i}s...   `);
        await sleep(1000);
    }
    process.stdout.write('\r  running...                              \n');

    const activeWindow = addon.getActiveWindow();
    console.log(`  active window: "${activeWindow.title}" (pid ${activeWindow.pid})`);

    if (!/notepad|untitled/i.test(activeWindow.title)) {
        console.log('  [SKIP] active window title does not look like Notepad;');
        console.log('         skipping to avoid typing into the wrong window.');
        return;
    }

    const expected = 'Hello 12345 🎉';

    try {
        // "H" via shift chord — exercises keyDown('shift') + letter
        addon.keyDown('shift'); addon.keyDown('h'); addon.keyUp('h'); addon.keyUp('shift');

        // "ello" plain letters
        for (const ch of 'ello') {
            addon.keyDown(ch); addon.keyUp(ch);
        }

        // Space
        addon.keyDown('space'); addon.keyUp('space');

        // Digits
        for (const ch of '12345') {
            addon.keyDown(ch); addon.keyUp(ch);
        }

        // Space
        addon.keyDown('space'); addon.keyUp('space');

        // Emoji via typeChar — exercises the surrogate-pair path
        const codepoint = '🎉'.codePointAt(0);
        addon.typeChar(codepoint);

        // Give the OS a moment to drain the input queue
        await sleep(150);

        // Ctrl+A to select all
        addon.keyDown('control'); addon.keyDown('a');
        addon.keyUp('a');         addon.keyUp('control');

        await sleep(50);

        // Ctrl+C to copy
        addon.keyDown('control'); addon.keyDown('c');
        addon.keyUp('c');         addon.keyUp('control');

        // Give the clipboard time to sync
        await sleep(200);

        const got = addon.clipboardGetText();

        console.log(`  expected: "${expected}"`);
        console.log(`  got:      "${got}"`);
        assert(got === expected, 'keyboard round-trip through Notepad matches');
    } finally {
        // Belt-and-braces: no matter what threw, do not leak modifier state.
        const released = addon.releaseAllModifiers();
        assert(released === true, 'releaseAllModifiers() returned true');
    }
}

// -----------------------------------------------------------------------------
// Async main — wraps everything so the Notepad section can await
// -----------------------------------------------------------------------------

(async () => {
    await keyboardNotepadRoundTrip();

    console.log(`\n---\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})();
