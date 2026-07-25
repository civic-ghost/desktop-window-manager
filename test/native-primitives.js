// test/native-primitives.js
//
// Exercises the native primitives via the seam (../lib/addon.js).
// Chunk 1: pid on window queries; UTF-8 titles; DPI awareness in Init.
// Chunk 2: setCursorPosition, getCursorPosition, mouseButton, mouseWheel.
// Chunk 3: clipboardSetText/GetText round-trip; lib/keys.js enum surface;
//          keyboard round-trip via Notepad.
// Chunk 4: captureScreen(target); captureDesktop/captureWindow regression.
// v0.5:    className on getWindows/getActiveWindow; WS_EX_TOOLWINDOW-based
//          filter (titleless windows now appear); closeWindow primitive.

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
        typeof w.handle    !== 'number' ||
        typeof w.pid       !== 'number' ||
        typeof w.className !== 'string' ||
        typeof w.title     !== 'string' ||
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
    assert(typeof active.className === 'string' && active.className.length > 0,
        `className is a non-empty string ("${active.className}")`);
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
        console.log('  (skipped — active window not in getWindows() result)');
        return;
    }
    assert(match.pid === active.pid,
        `pid agrees (${match.pid} === ${active.pid})`);
    assert(match.title === active.title,
        `title agrees ("${match.title}" === "${active.title}")`);
    assert(match.className === active.className,
        `className agrees ("${match.className}" === "${active.className}")`);
});

section('UTF-8 window titles', () => {
    const windows = addon.getWindows();
    const nonAscii = windows.filter(w => /[^\x00-\x7F]/.test(w.title));

    console.log(`  total windows: ${windows.length}`);
    console.log(`  non-ASCII titles: ${nonAscii.length}`);
    if (nonAscii.length === 0) {
        console.log('  (no non-ASCII titles present — open something with a Unicode title');
        console.log('   to exercise the UTF-16 -> UTF-8 conversion path)');
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
// v0.5 sections — className and filter change
// -----------------------------------------------------------------------------

section('className field on every window', () => {
    const windows = addon.getWindows();

    const missing = windows.filter(w => typeof w.className !== 'string');
    assert(missing.length === 0, `every window has className as a string (${missing.length} missing)`);

    // A real HWND always has a non-empty class name from Windows. If we see
    // an empty one, either GetClassNameW failed (buffer or destroyed window)
    // or something is off in the read path.
    const empty = windows.filter(w => w.className === '');
    assert(empty.length === 0, `every className is non-empty (${empty.length} empty)`);

    console.log('  sample class names:');
    windows.slice(0, 5).forEach(w => {
        const titlePreview = w.title ? `"${w.title.slice(0, 40)}"` : '(no title)';
        console.log(`    - class "${w.className}" — ${titlePreview}`);
    });
});

section('titleless windows now visible (v0.5 filter change)', () => {
    // The v0.5 change dropped the "must have a non-empty title" filter and
    // replaced it with a WS_EX_TOOLWINDOW-based filter. Titleless windows
    // (identifiable only by className) are now returned. Presence depends
    // on what's running, so this is observational — no hard assertion on
    // the count.
    const windows = addon.getWindows();
    const titleless = windows.filter(w => w.title === '');

    console.log(`  titleless windows: ${titleless.length} of ${windows.length} total`);
    if (titleless.length > 0) {
        console.log('  sample titleless class names:');
        titleless.slice(0, 10).forEach(w => {
            console.log(`    - class "${w.className}" (pid ${w.pid})`);
        });
    } else {
        console.log('  (none present at this moment — depends on what dialogs are open)');
    }
});

section('closeWindow() surface', () => {
    assert(typeof addon.closeWindow === 'function', 'exported as a function');

    let threw = false;
    try { addon.closeWindow('not a handle'); } catch (e) { threw = true; }
    assert(threw, 'rejects non-numeric handle');

    threw = false;
    try { addon.closeWindow(); } catch (e) { threw = true; }
    assert(threw, 'rejects missing argument');

    // An obviously-invalid handle should return false, not throw.
    const result = addon.closeWindow(0xDEADBEEF);
    assert(result === false, 'returns false for invalid handle (does not throw)');
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
    const expected = 26 + 10 + 24 + 12 + 10 + 5 + 16 + 11;
    assert(keys.ALL.size === expected,
        `ALL contains ${keys.ALL.size} names (expected ${expected})`);

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

    if (original) {
        try { addon.clipboardSetText(original); } catch (e) { /* ignore */ }
    }
});

// -----------------------------------------------------------------------------
// Chunk 4 sections — screen capture
// -----------------------------------------------------------------------------

function assertCaptureShape(label, cap) {
    assert(cap !== null && typeof cap === 'object', `${label}: returns an object`);
    if (!cap) return false;
    assert(Buffer.isBuffer(cap.data), `${label}: data is a Buffer`);
    assert(typeof cap.width  === 'number' && cap.width  > 0, `${label}: width > 0 (${cap.width})`);
    assert(typeof cap.height === 'number' && cap.height > 0, `${label}: height > 0 (${cap.height})`);
    const expected = cap.width * cap.height * 4;
    assert(cap.data.length === expected,
        `${label}: data length matches width*height*4 (${cap.data.length} === ${expected})`);
    if (cap.data.length >= 4) {
        const alphaOk =
            cap.data[3] === 255 &&
            cap.data[cap.data.length - 1] === 255 &&
            cap.data[Math.floor(cap.data.length / 2 / 4) * 4 + 3] === 255;
        assert(alphaOk, `${label}: alpha channel is 0xFF at sampled pixels`);
    }
    return true;
}

section('captureDesktop() still works (regression after refactor)', () => {
    const cap = addon.captureDesktop();
    assertCaptureShape('captureDesktop', cap);
});

section('captureWindow() still works (regression after refactor)', () => {
    const active = addon.getActiveWindow();
    if (!active) {
        console.log('  (skipped — no active window)');
        return;
    }
    const cap = addon.captureWindow(active.handle);
    assertCaptureShape('captureWindow', cap);
    const dw = Math.abs(cap.width  - active.size.width);
    const dh = Math.abs(cap.height - active.size.height);
    assert(dw <= 4 && dh <= 4,
        `dimensions close to active window size — active ${active.size.width}x${active.size.height}, capture ${cap.width}x${cap.height}`);
});

section('captureScreen() with no arg defaults to primary', () => {
    const cap = addon.captureScreen();
    assertCaptureShape('captureScreen()', cap);
});

section("captureScreen('primary')", () => {
    const cap = addon.captureScreen('primary');
    assertCaptureShape("captureScreen('primary')", cap);
});

section("captureScreen('primary') matches captureDesktop dimensions", () => {
    const desktop = addon.captureDesktop();
    const primary = addon.captureScreen('primary');
    assert(desktop.width  === primary.width &&
           desktop.height === primary.height,
        `${desktop.width}x${desktop.height} === ${primary.width}x${primary.height}`);
});

section('captureScreen(0) — first enumerated monitor', () => {
    const cap = addon.captureScreen(0);
    assertCaptureShape('captureScreen(0)', cap);
});

section("captureScreen('all') — virtual desktop", () => {
    const all     = addon.captureScreen('all');
    const primary = addon.captureScreen('primary');
    assertCaptureShape("captureScreen('all')", all);
    assert(all.width  >= primary.width &&
           all.height >= primary.height,
        `virtual >= primary (${all.width}x${all.height} >= ${primary.width}x${primary.height})`);
});

section('captureScreen invalid targets rejected', () => {
    let threw = false;
    try { addon.captureScreen('nonsense'); } catch (e) { threw = true; }
    assert(threw, "captureScreen('nonsense') throws");

    threw = false;
    try { addon.captureScreen(999); } catch (e) { threw = true; }
    assert(threw, 'captureScreen(999) throws (index out of range)');

    threw = false;
    try { addon.captureScreen(-1); } catch (e) { threw = true; }
    assert(threw, 'captureScreen(-1) throws (negative index)');

    threw = false;
    try { addon.captureScreen({}); } catch (e) { threw = true; }
    assert(threw, 'captureScreen({}) throws (non-string, non-number)');
});

// -----------------------------------------------------------------------------
// Async: Notepad round-trip + closeWindow behavior
// -----------------------------------------------------------------------------

async function keyboardNotepadRoundTrip() {
    console.log('\n=== keyboard round-trip via Notepad (+ v0.5 closeWindow) ===');
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
    console.log('  - clear the buffer, then closeWindow(notepadHandle)');
    console.log('  - verify Notepad is no longer in getWindows()');
    console.log('');
    console.log('Press Ctrl+C now to skip.');

    for (let i = 5; i > 0; i--) {
        process.stdout.write(`\r  focus Notepad — starting in ${i}s...   `);
        await sleep(1000);
    }
    process.stdout.write('\r  running...                              \n');

    const activeWindow = addon.getActiveWindow();
    console.log(`  active window: "${activeWindow.title}" [${activeWindow.className}] (pid ${activeWindow.pid})`);

    if (!/notepad|untitled/i.test(activeWindow.title) &&
        !/notepad/i.test(activeWindow.className)) {
        console.log('  [SKIP] active window does not look like Notepad;');
        console.log('         skipping to avoid typing into the wrong window.');
        return;
    }

    const expected = 'Hello 12345 🎉';

    try {
        // Type the known string
        addon.keyDown('shift'); addon.keyDown('h'); addon.keyUp('h'); addon.keyUp('shift');

        for (const ch of 'ello') {
            addon.keyDown(ch); addon.keyUp(ch);
        }

        addon.keyDown('space'); addon.keyUp('space');

        for (const ch of '12345') {
            addon.keyDown(ch); addon.keyUp(ch);
        }

        addon.keyDown('space'); addon.keyUp('space');

        const codepoint = '🎉'.codePointAt(0);
        addon.typeChar(codepoint);

        await sleep(150);

        // Ctrl+A + Ctrl+C
        addon.keyDown('control'); addon.keyDown('a');
        addon.keyUp('a');         addon.keyUp('control');

        await sleep(50);

        addon.keyDown('control'); addon.keyDown('c');
        addon.keyUp('c');         addon.keyUp('control');

        await sleep(200);

        const got = addon.clipboardGetText();

        console.log(`  expected: "${expected}"`);
        console.log(`  got:      "${got}"`);
        assert(got === expected, 'keyboard round-trip through Notepad matches');

        // v0.5: prepare Notepad for a clean close by clearing the buffer.
        // Ctrl+A + Delete makes the content match the last-saved state
        // (empty for a new file), so modern Notepad drops the dirty flag
        // and WM_CLOSE closes without prompting.
        addon.keyDown('control'); addon.keyDown('a');
        addon.keyUp('a');         addon.keyUp('control');
        await sleep(50);
        addon.keyDown('delete'); addon.keyUp('delete');
        await sleep(100);

        // Now close via closeWindow
        const notepadHandle = activeWindow.handle;
        const closed = addon.closeWindow(notepadHandle);
        assert(closed === true, 'closeWindow(notepadHandle) returned true');

        // Give Notepad a moment to process WM_CLOSE and tear down
        await sleep(400);

        // Verify it's actually gone. If a save prompt appeared instead
        // (e.g. on an older Notepad that doesn't clear its dirty flag),
        // this will fail — the "closeWindow returned true" claim still
        // held, but closure did not occur. That's the documented contract.
        const windowsAfter = addon.getWindows();
        const stillThere = windowsAfter.some(w => w.handle === notepadHandle);
        assert(!stillThere,
            'Notepad handle is no longer in getWindows() after closeWindow');

        if (stillThere) {
            console.log('  [NOTE] Notepad still present — a save prompt may have appeared.');
            console.log('         This does not invalidate closeWindow (it posted the message);');
            console.log('         it demonstrates the "return true is not a closure claim" contract.');
        }
    } finally {
        const released = addon.releaseAllModifiers();
        assert(released === true, 'releaseAllModifiers() returned true');
    }
}

// -----------------------------------------------------------------------------
// Async main
// -----------------------------------------------------------------------------

(async () => {
    await keyboardNotepadRoundTrip();

    console.log(`\n---\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})();
