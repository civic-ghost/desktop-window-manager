// test/keyboard.test.js — manual test harness for lib/keyboard.js.
//
// Run from the test/ folder:
//   node keyboard.test.js
//
// Same plain pass/fail style as screen.test.js and path.test.js. Three kinds
// of checks:
//
//   1. Validation — invalid key names throw, no window needed.
//   2. Timing — holdMs actually holds, using 'shift' alone (no visible
//      character produced, safe to tap without a focused target mattering).
//   3. Functional — real key events land in a throwaway Notepad instance and
//      are verified by reading them back via the clipboard (select-all,
//      copy, clipboardGetText). This is the only way to *prove* keyDown/keyUp
//      actually produced the right characters in the right order, rather
//      than just asserting "didn't throw."
//
// Notepad is spawned as the target (never whatever window happens to be
// focused) and closed at the end, same convention as screen.test.js.

const { spawn } = require('child_process');
const keyboard = require('../lib/keyboard');
const screen = require('../lib/screen');
const addon = require('../lib/addon');

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

async function checkThrows(label, fn) {
    let threw = false;
    let name = null;
    try {
        await fn();
    } catch (err) {
        threw = true;
        name = err.name;
    }
    check(label, threw && name === 'TypeError', `threw=${threw} name=${name}`);
}

function findWindowByPid(pid, timeoutMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            const match = screen.getWindows().find(w => w.pid === pid);
            if (match) return resolve(match);
            if (Date.now() - start > timeoutMs) {
                return reject(new Error(`Timed out waiting for window with pid ${pid}`));
            }
            setTimeout(poll, 100);
        };
        poll();
    });
}

// ---------------------------------------------------------------------------
// Validation — no window needed
// ---------------------------------------------------------------------------

async function testValidation() {
    console.log('\nValidation — invalid key names throw');

    await checkThrows("tapKey('not_a_real_key') throws TypeError",
        () => keyboard.tapKey('not_a_real_key'));

    await checkThrows("keyChord([], 'not_a_real_key') throws TypeError",
        () => keyboard.keyChord([], 'not_a_real_key'));

    await checkThrows("keyChord(['not_a_modifier'], 'a') throws TypeError",
        () => keyboard.keyChord(['not_a_modifier'], 'a'));
}

// ---------------------------------------------------------------------------
// Timing — holdMs, using 'shift' alone (no visible character)
// ---------------------------------------------------------------------------

async function testTapKeyTiming() {
    console.log("\ntapKey() — holdMs dwell timing (key: 'shift', no visible effect)");

    const t0 = Date.now();
    await keyboard.tapKey('shift', { holdMs: 200 });
    const elapsedHeld = Date.now() - t0;
    check('tapKey holdMs=200 takes at least ~180ms', elapsedHeld >= 180, `elapsed=${elapsedHeld}ms`);

    const t1 = Date.now();
    await keyboard.tapKey('shift');
    const elapsedDefault = Date.now() - t1;
    check('tapKey with default holdMs (0) is near-instant (<80ms)', elapsedDefault < 80,
        `elapsed=${elapsedDefault}ms`);
}

async function testKeyChordTiming() {
    console.log("\nkeyChord() — holdMs dwell timing (no modifiers, key: 'shift')");

    const t0 = Date.now();
    await keyboard.keyChord([], 'shift', { holdMs: 200 });
    const elapsedHeld = Date.now() - t0;
    check('keyChord holdMs=200 takes at least ~180ms', elapsedHeld >= 180, `elapsed=${elapsedHeld}ms`);

    const t1 = Date.now();
    await keyboard.keyChord([], 'shift');
    const elapsedDefault = Date.now() - t1;
    check('keyChord with default holdMs (0) is near-instant (<80ms)', elapsedDefault < 80,
        `elapsed=${elapsedDefault}ms`);
}

// ---------------------------------------------------------------------------
// Functional — real key events into a throwaway Notepad, verified via clipboard
// ---------------------------------------------------------------------------

async function testFunctionalAgainstNotepad() {
    console.log('\nFunctional — real key events verified via Notepad + clipboard');

    const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
    let notepadWindow;

    try {
        notepadWindow = await findWindowByPid(child.pid);
        check('spawned Notepad window found', !!notepadWindow);
    } catch (err) {
        check('spawned Notepad window found', false, err.message);
        try { child.kill(); } catch (_) { /* ignore */ }
        return;
    }

    screen.focusWindowByHandle(notepadWindow.handle);
    await sleep(200);

    // tapKey: type "hi" one character at a time.
    await keyboard.tapKey('h');
    await keyboard.tapKey('i');
    await sleep(50);

    // keyChord: Shift+A should produce an uppercase 'A'. If modifier/key
    // ordering were wrong (e.g. shift released before 'a' is pressed), this
    // would come out lowercase instead — so this is a real test of the
    // ordering contract, not just "didn't throw."
    await keyboard.keyChord(['shift'], 'a');
    await sleep(50);

    // releaseAllModifiers: simulate a "stuck" shift by pressing it down
    // directly via the addon (bypassing keyboard.js's own up/down pairing),
    // then call releaseAllModifiers() and confirm a subsequent tapKey('b')
    // comes out lowercase — proving shift was actually released rather than
    // left down.
    addon.keyDown('shift');
    keyboard.releaseAllModifiers();
    await keyboard.tapKey('b');
    await sleep(50);

    // Expected buffer contents so far: "hiAb"
    await keyboard.keyChord(['control'], 'a'); // select all
    await sleep(50);
    await keyboard.keyChord(['control'], 'c'); // copy
    await sleep(100);

    const clipboardText = addon.clipboardGetText();
    check("typed text reads back as 'hiAb' via clipboard",
        clipboardText === 'hiAb',
        `got '${clipboardText}'`);

    // Clean up.
    screen.closeWindow(notepadWindow.handle);
    await sleep(300);
    const stillPresent = screen.getWindows().find(w => w.handle === notepadWindow.handle);
    if (stillPresent) {
        try { child.kill(); } catch (_) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// releaseAllModifiers — return shape
// ---------------------------------------------------------------------------

function testReleaseAllModifiersReturnShape() {
    console.log('\nreleaseAllModifiers() — return shape');
    const result = keyboard.releaseAllModifiers();
    check('returns a boolean', typeof result === 'boolean', `got ${typeof result}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== lib/keyboard.js test suite ===');

    await testValidation();
    await testTapKeyTiming();
    await testKeyChordTiming();
    testReleaseAllModifiersReturnShape();
    await testFunctionalAgainstNotepad();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('Unhandled error in test run:', err);
    process.exitCode = 1;
});
