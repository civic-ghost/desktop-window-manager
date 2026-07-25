// test/plan_executor.test.js — manual test harness for runKeystrokePlan
// (spec §11.3), exercising the full pipeline: builder -> executor -> real
// key events -> clipboard readback.
//
// Run from the test/ folder:
//   node plan_executor.test.js
//
// Unlike compiler.test.js and plan_builders.test.js, this module DOES touch
// the native addon (via keyChord/typeChar), so every test here needs a real
// Windows target. Each functional/timing/abort group spawns its own
// throwaway Notepad instance (never whatever window happens to be focused)
// and closes it when done, via the withNotepad() helper below.
//
// Four groups:
//   1. Empty plan — no window needed, resolves without throwing.
//   2. Functional pipeline — makeLinearKeystrokePlan -> runKeystrokePlan,
//      verified by reading the typed text back via the clipboard. Includes
//      a char-atom (em dash) to prove the 'char' dispatch path (typeChar)
//      actually fires, not just the 'chord' path.
//   3. Timing — confirms the executor actually honors preDelayMs and holdMs
//      at runtime, not just that the plan carries the right numbers.
//   4. Abort — a pre-aborted signal (proves releaseAllModifiers() actually
//      clears a simulated stuck modifier) and a mid-plan abort (proves
//      execution genuinely stops partway rather than running to completion).

const { spawn } = require('child_process');
const { makeLinearKeystrokePlan } = require('../lib/keystroke/linear_plan');
const { runKeystrokePlan } = require('../lib/keystroke/plan_executor');
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

/**
 * Spawn a throwaway Notepad, focus it, run `fn(notepadWindow)`, then close
 * it — regardless of whether fn throws. Mirrors the convention established
 * in screen.test.js and keyboard.test.js.
 */
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

/** Select all + copy in the currently focused window, return clipboard text. */
async function readBackViaClipboard() {
    await keyboard.keyChord(['control'], 'a');
    await sleep(50);
    await keyboard.keyChord(['control'], 'c');
    await sleep(100);
    return addon.clipboardGetText();
}

// ---------------------------------------------------------------------------
// Group 1 — empty plan, no window needed
// ---------------------------------------------------------------------------

async function testEmptyPlan() {
    console.log('\nrunKeystrokePlan() — empty plan');
    let threw = false;
    try {
        await runKeystrokePlan([]);
    } catch (err) {
        threw = true;
    }
    check('runKeystrokePlan([]) resolves without throwing', !threw);
}

// ---------------------------------------------------------------------------
// Group 2 — functional pipeline: builder -> executor -> clipboard readback
// ---------------------------------------------------------------------------

async function testFunctionalPipeline() {
    console.log('\nrunKeystrokePlan() — full pipeline (chord + char atoms) via Notepad');

    await withNotepad('functional pipeline', async () => {
        // Includes: lowercase, uppercase (shift chord), a shifted-digit
        // symbol, and an em dash (char atom, exercises the typeChar path).
        const text = 'Hi! Go\u2014now';
        const plan = makeLinearKeystrokePlan(text, { charDelay: 10, holdMs: 15 });

        await runKeystrokePlan(plan);
        await sleep(100);

        const result = await readBackViaClipboard();
        check(`typed text reads back as '${text}' via clipboard`,
            result === text, `got '${result}'`);
    });
}

// ---------------------------------------------------------------------------
// Group 3 — timing: executor actually honors preDelayMs / holdMs at runtime
// ---------------------------------------------------------------------------

async function testTiming() {
    console.log('\nrunKeystrokePlan() — timing (preDelayMs + holdMs honored at runtime)');

    await withNotepad('timing', async () => {
        const text = 'abcde'; // 5 chord atoms, no shift needed
        const charDelay = 80;
        const holdMs = 40;
        const plan = makeLinearKeystrokePlan(text, { charDelay, holdMs });

        // Expected lower bound: 4 inter-atom gaps (first atom has none) +
        // 5 holds. Loose upper bound to allow for scheduler/native overhead.
        const expectedMin = (text.length - 1) * charDelay + text.length * holdMs;

        const t0 = Date.now();
        await runKeystrokePlan(plan);
        const elapsed = Date.now() - t0;

        check(`elapsed time (${elapsed}ms) is at least the expected minimum (${expectedMin}ms)`,
            elapsed >= expectedMin * 0.9, // small tolerance for timer granularity
            `elapsed=${elapsed}ms expectedMin=${expectedMin}ms`);
        check(`elapsed time (${elapsed}ms) isn't wildly over the expected minimum (generous 3x ceiling)`,
            elapsed <= expectedMin * 3,
            `elapsed=${elapsed}ms expectedMin=${expectedMin}ms`);
    });
}

// ---------------------------------------------------------------------------
// Group 4 — abort behavior
// ---------------------------------------------------------------------------

async function testAbortPreAbortedReleasesStuckModifier() {
    console.log('\nrunKeystrokePlan() — pre-aborted signal: releaseAllModifiers() safety net');

    await withNotepad('pre-aborted abort', async () => {
        // Simulate a stuck shift by pressing it directly via the addon,
        // bypassing keyboard.js's own up/down pairing entirely.
        addon.keyDown('shift');

        const controller = new AbortController();
        controller.abort(); // already aborted before runKeystrokePlan starts

        const plan = makeLinearKeystrokePlan('XYZ', { charDelay: 0 });

        let rejected = false;
        let errorName = null;
        try {
            await runKeystrokePlan(plan, { signal: controller.signal });
        } catch (err) {
            rejected = true;
            errorName = err.name;
        }

        check('runKeystrokePlan rejects immediately for a pre-aborted signal', rejected);
        check('rejection is an AbortError', errorName === 'AbortError', `got name=${errorName}`);

        // Nothing from the plan should have been typed — confirm via a
        // fresh tapKey('a'). If shift were still stuck, this would read back
        // as 'A' instead of 'a'.
        await keyboard.tapKey('a');
        await sleep(50);

        const result = await readBackViaClipboard();
        check("only 'a' was typed, lowercase — proving releaseAllModifiers() cleared the stuck shift",
            result === 'a', `got '${result}'`);
    });
}

async function testAbortMidPlanStopsPartway() {
    console.log('\nrunKeystrokePlan() — mid-plan abort stops execution partway');

    await withNotepad('mid-plan abort', async () => {
        const text = 'abcdefghij'; // 10 chord atoms
        const charDelay = 150;
        const plan = makeLinearKeystrokePlan(text, { charDelay });

        const controller = new AbortController();
        setTimeout(() => controller.abort(), 500); // abort partway through

        let rejected = false;
        let errorName = null;
        try {
            await runKeystrokePlan(plan, { signal: controller.signal });
        } catch (err) {
            rejected = true;
            errorName = err.name;
        }

        check('runKeystrokePlan rejects when aborted mid-plan', rejected);
        check('rejection is an AbortError', errorName === 'AbortError', `got name=${errorName}`);

        const result = await readBackViaClipboard();
        check('typed text is a strict prefix of the full text (execution stopped early)',
            result.length > 0 && result.length < text.length && text.startsWith(result),
            `got '${result}' (full text was '${text}')`);
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== lib/keystroke/plan_executor.js test suite (spec §11.3) ===');

    await testEmptyPlan();
    await testFunctionalPipeline();
    await testTiming();
    await testAbortPreAbortedReleasesStuckModifier();
    await testAbortMidPlanStopsPartway();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('Unhandled error in test run:', err);
    process.exitCode = 1;
});
