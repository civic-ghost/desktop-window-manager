// test/clipboard.test.js — manual test harness for lib/clipboard.js.
//
// Run from the test/ folder:
//   node clipboard.test.js
//
// This module touches the real native addon (clipboardSetText/GetText) and,
// via paste(), real keystroke injection (Ctrl+V) — so this suite needs a
// real Windows target. I could not run it myself in this sandbox.
//
// Four groups:
//   1. clipboardSetText/clipboardGetText round-trip — no window/focus needed,
//      since clipboard reads/writes don't depend on what's focused.
//   2. paste() functional, default options — verified end-to-end via a
//      throwaway Notepad: paste some text, then independently read Notepad's
//      actual buffer back (select-all + copy + clipboardGetText) to confirm
//      it really landed there.
//   3. paste() with options.verify=true, the success path — same as above,
//      plus confirming the return value is true.
//   4. paste() with options.verify=true, a FORCED mismatch — addon.clipboardGetText
//      is temporarily monkeypatched to always return the wrong string, so we
//      can deterministically exercise the "verification fails" path without
//      needing a real race condition. Confirms: paste() returns false, and —
//      more importantly — that Ctrl+V was genuinely never sent (Notepad's
//      real buffer stays empty), not just that the return value looks right.

const { spawn } = require('child_process');
const clipboard = require('../lib/clipboard');
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

/** Spawn a throwaway Notepad, focus it, run fn(), then close it regardless. */
async function withNotepad(label, fn) {
    const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
    let notepadWindow;

    try {
        notepadWindow = await findWindowByPid(child.pid);
    } catch (err) {
        check(`${label}: spawned Notepad window found`, false, err.message);
        try { child.kill(); } catch (_) { /* ignore */ }
        return;
    }

    screen.focusWindowByHandle(notepadWindow.handle);
    await sleep(200);

    try {
        await fn(notepadWindow);
    } finally {
        screen.closeWindow(notepadWindow.handle);
        await sleep(300);
        const stillPresent = screen.getWindows().find(w => w.handle === notepadWindow.handle);
        if (stillPresent) {
            try { child.kill(); } catch (_) { /* ignore */ }
        }
    }
}

/**
 * Read back whatever's actually in the focused window via a genuine
 * select-all + copy + clipboardGetText — independent of clipboard.js's own
 * clipboardGetText wrapper, so this serves as ground truth even when we've
 * been monkeypatching addon.clipboardGetText elsewhere in the same test.
 *
 * Seeds a sentinel value onto the clipboard immediately before the
 * select-all+copy. This matters because Ctrl+A on an EMPTY document selects
 * nothing, and Ctrl+C with nothing selected is a no-op in Notepad — it does
 * NOT clear or overwrite the clipboard. Without the sentinel, a no-op copy
 * would silently return whatever was already on the clipboard from before
 * (e.g. text paste() itself wrote via clipboardSetText moments earlier,
 * even in a verification-failed run where Ctrl+V was correctly never sent),
 * which looks identical to "the text really is in Notepad" and produces a
 * false failure. With the sentinel: if the document is genuinely empty, the
 * readback comes back as the sentinel (mapped to '' below); if there's real
 * content, select-all+copy overwrites the sentinel with it as expected.
 */
async function readBackNotepadContent() {
    const EMPTY_SENTINEL = '__CLIPBOARD_TEST_EMPTY_SENTINEL__';
    addon.clipboardSetText(EMPTY_SENTINEL);

    await keyboard.keyChord(['control'], 'a');
    await sleep(50);
    await keyboard.keyChord(['control'], 'c');
    await sleep(100);

    const result = addon.clipboardGetText();
    return result === EMPTY_SENTINEL ? '' : result;
}

// ---------------------------------------------------------------------------
// Group 1 — clipboardSetText / clipboardGetText round-trip
// ---------------------------------------------------------------------------

function testClipboardRoundTrip() {
    console.log('\nclipboardSetText() / clipboardGetText() — round-trip (no window needed)');

    clipboard.clipboardSetText('plain ascii text');
    check("round-trips plain ASCII text",
        clipboard.clipboardGetText() === 'plain ascii text',
        `got '${clipboard.clipboardGetText()}'`);

    const unicodeText = 'unicode: café \u2014 \u{1F600}';
    clipboard.clipboardSetText(unicodeText);
    check('round-trips Unicode text (accented char, em dash, emoji)',
        clipboard.clipboardGetText() === unicodeText,
        `got '${clipboard.clipboardGetText()}'`);

    clipboard.clipboardSetText('');
    check('round-trips an empty string',
        clipboard.clipboardGetText() === '',
        `got '${clipboard.clipboardGetText()}'`);
}

// ---------------------------------------------------------------------------
// Group 2 — paste(), default options
// ---------------------------------------------------------------------------

async function testPasteDefault() {
    console.log('\npaste() — default options, end-to-end via Notepad');

    await withNotepad('paste default', async () => {
        const text = 'Hello from paste()! \u2014 \u2713';
        const result = await clipboard.paste(text);

        check('paste() returns true when verification is not requested',
            result === true, `got ${result}`);

        const actual = await readBackNotepadContent();
        check(`text actually landed in Notepad via Ctrl+V`,
            actual === text, `got '${actual}'`);
    });
}

// ---------------------------------------------------------------------------
// Group 3 — paste() with options.verify=true, success path
// ---------------------------------------------------------------------------

async function testPasteVerifySucceeds() {
    console.log('\npaste() — options.verify=true, normal (successful) case');

    await withNotepad('paste verify success', async () => {
        const text = 'Verified paste content';
        const result = await clipboard.paste(text, { verify: true });

        check('paste() returns true when verification succeeds',
            result === true, `got ${result}`);

        const actual = await readBackNotepadContent();
        check('text landed in Notepad when verification succeeded',
            actual === text, `got '${actual}'`);
    });
}

// ---------------------------------------------------------------------------
// Group 4 — paste() with options.verify=true, FORCED mismatch
// ---------------------------------------------------------------------------

async function testPasteVerifyFails() {
    console.log('\npaste() — options.verify=true, forced readback mismatch');

    await withNotepad('paste verify failure', async () => {
        const text = 'This text should never appear';

        // Record what gets written, while forcing the readback to always
        // report something different — deterministically simulating a
        // flaky/mismatched clipboard write without a real race condition.
        const originalClipboardSetText = addon.clipboardSetText;
        const originalClipboardGetText = addon.clipboardGetText;
        const setTextCalls = [];

        addon.clipboardSetText = (value) => {
            setTextCalls.push(value);
            return originalClipboardSetText(value);
        };
        addon.clipboardGetText = () => 'DELIBERATELY WRONG VALUE';

        let result;
        try {
            result = await clipboard.paste(text, { verify: true });
        } finally {
            addon.clipboardSetText = originalClipboardSetText;
            addon.clipboardGetText = originalClipboardGetText;
        }

        check('paste() returns false when verification fails',
            result === false, `got ${result}`);
        check('the clipboard write was still attempted with the correct text',
            setTextCalls.length === 1 && setTextCalls[0] === text,
            `calls=${JSON.stringify(setTextCalls)}`);

        // Ground truth: Ctrl+V must never have been sent, so Notepad's real
        // buffer (read back via the NOW-RESTORED, genuine clipboardGetText)
        // should still be empty.
        const actual = await readBackNotepadContent();
        check('Ctrl+V was never sent — Notepad remains empty after a failed verification',
            actual === '', `got '${actual}'`);
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== lib/clipboard.js test suite (spec §9) ===');

    testClipboardRoundTrip();
    await testPasteDefault();
    await testPasteVerifySucceeds();
    await testPasteVerifyFails();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('Unhandled error in test run:', err);
    process.exitCode = 1;
});
