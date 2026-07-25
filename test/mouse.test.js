// test/mouse.test.js — manual test harness for lib/mouse.js.
//
// Run from the test/ folder:
//   node mouse.test.js
//
// Three kinds of checks:
//
//   1. Spy-based mechanical checks — click/doubleClick/tripleClick/mouseDown/
//      mouseUp/scroll are mostly about CALL SEQUENCE and TIMING, not visual
//      outcome. Rather than guessing pixel coordinates to verify real clicks
//      landed somewhere meaningful, we temporarily monkeypatch addon.mouseButton
//      / addon.mouseWheel to record calls, same technique as the Box-Muller
//      formula-conformance check in plan_builders.test.js. Deterministic,
//      no OS/UI dependency beyond the addon load itself.
//
//   2. Real cursor movement — moveTo's actual effect IS visual/positional,
//      so this is verified against the real OS cursor position via
//      screen.getCursorPosition(), same pattern as path.test.js.
//
//   3. One real drag-selection test — mouseDown + moveTo + mouseUp composed
//      manually against a throwaway Notepad, verifying SOME text got
//      selected and copied. This does not attempt to assert an exact
//      substring (that would require knowing Notepad's font metrics /
//      window-chrome height, which vary by Windows version and DPI) — it's
//      a loose "the primitives compose into a working drag" smoke test.
//
// NOTE: this module touches the real native addon (mouseButton, mouseWheel,
// getCursorPosition), so this suite needs a real Windows target — I could
// not run it myself in this sandbox.

const { spawn } = require('child_process');
const mouse = require('../lib/mouse');
const { plotRoute } = require('../lib/path/route_executor');
const { bezierPath } = require('../lib/path/bezier_path');
const screen = require('../lib/screen');
const keyboard = require('../lib/keyboard');
const addon = require('../lib/addon');

// See path.test.js for the full explanation: setCursorPosition's SendInput
// normalized-coordinate round trip has an inherent ~1px rounding
// quantization, confirmed on real hardware. ±2px gives a little headroom.
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

/** Temporarily replace addon.mouseButton with a spy; returns {calls, restore}. */
function spyOnMouseButton() {
    const calls = [];
    const original = addon.mouseButton;
    addon.mouseButton = (button, direction) => {
        calls.push({ button, direction, t: Date.now() });
        return true;
    };
    return { calls, restore: () => { addon.mouseButton = original; } };
}

/** Temporarily replace addon.mouseWheel with a spy; returns {calls, restore}. */
function spyOnMouseWheel() {
    const calls = [];
    const original = addon.mouseWheel;
    addon.mouseWheel = (amount) => {
        calls.push(amount);
        return true;
    };
    return { calls, restore: () => { addon.mouseWheel = original; } };
}

// ---------------------------------------------------------------------------
// Group 1 — validation
// ---------------------------------------------------------------------------

async function testInvalidButtonValidation() {
    console.log('\nValidation — invalid mouse button throws, and never reaches the addon');

    const spy = spyOnMouseButton();
    try {
        await checkThrows("mouseDown('nonsense') throws TypeError",
            () => mouse.mouseDown('nonsense'));
        await checkThrows("mouseUp('nonsense') throws TypeError",
            () => mouse.mouseUp('nonsense'));
        await checkThrows("click('nonsense') throws TypeError",
            () => mouse.click('nonsense'));

        check('none of the invalid-button calls reached addon.mouseButton',
            spy.calls.length === 0, `calls=${JSON.stringify(spy.calls)}`);
    } finally {
        spy.restore();
    }
}

// ---------------------------------------------------------------------------
// Group 2 — click / doubleClick / tripleClick mechanics, via spy
// ---------------------------------------------------------------------------

async function testClickSequenceAndTiming() {
    console.log('\nclick() — sequence and holdMs timing (spied)');

    const spy = spyOnMouseButton();
    try {
        await mouse.click('left', { holdMs: 120 });

        check('click() calls mouseButton exactly twice (down, up)',
            spy.calls.length === 2, `calls=${JSON.stringify(spy.calls)}`);
        check("first call is ('left', 'down')",
            spy.calls[0] && spy.calls[0].button === 'left' && spy.calls[0].direction === 'down');
        check("second call is ('left', 'up')",
            spy.calls[1] && spy.calls[1].button === 'left' && spy.calls[1].direction === 'up');

        const dwell = spy.calls[1].t - spy.calls[0].t;
        check(`holdMs=120 produces a down-to-up dwell of at least ~100ms`,
            dwell >= 100, `dwell=${dwell}ms`);
    } finally {
        spy.restore();
    }
}

async function testClickDefaultNoDwell() {
    console.log('\nclick() — default holdMs=0 is near-instant (spied)');

    const spy = spyOnMouseButton();
    try {
        await mouse.click('right');
        const dwell = spy.calls[1].t - spy.calls[0].t;
        check('default holdMs=0 produces a near-instant down-to-up (<50ms)',
            dwell < 50, `dwell=${dwell}ms`);
        check("button 'right' passed through correctly",
            spy.calls.every(c => c.button === 'right'));
    } finally {
        spy.restore();
    }
}

async function testDoubleClickSequenceAndTiming() {
    console.log('\ndoubleClick() — sequence and interClickDelay timing (spied)');

    const spy = spyOnMouseButton();
    try {
        await mouse.doubleClick('left', { interClickDelay: 100 });

        check('doubleClick() calls mouseButton exactly 4 times (down,up,down,up)',
            spy.calls.length === 4, `calls=${JSON.stringify(spy.calls)}`);
        check('pattern is down,up,down,up',
            spy.calls.map(c => c.direction).join(',') === 'down,up,down,up');

        const gap = spy.calls[2].t - spy.calls[1].t; // between click 1's up and click 2's down
        check('interClickDelay=100 produces a gap of at least ~85ms between clicks',
            gap >= 85, `gap=${gap}ms`);
    } finally {
        spy.restore();
    }
}

async function testTripleClickSequenceAndTiming() {
    console.log('\ntripleClick() — sequence and interClickDelay timing (spied)');

    const spy = spyOnMouseButton();
    try {
        await mouse.tripleClick('left', { interClickDelay: 80 });

        check('tripleClick() calls mouseButton exactly 6 times',
            spy.calls.length === 6, `calls=${JSON.stringify(spy.calls)}`);
        check('pattern is down,up,down,up,down,up',
            spy.calls.map(c => c.direction).join(',') === 'down,up,down,up,down,up');

        const gap1 = spy.calls[2].t - spy.calls[1].t;
        const gap2 = spy.calls[4].t - spy.calls[3].t;
        check('both inter-click gaps are at least ~65ms',
            gap1 >= 65 && gap2 >= 65, `gap1=${gap1}ms gap2=${gap2}ms`);
    } finally {
        spy.restore();
    }
}

async function testMouseDownUp() {
    console.log('\nmouseDown() / mouseUp() — single-call primitives (spied)');

    const spy = spyOnMouseButton();
    try {
        mouse.mouseDown('middle');
        mouse.mouseUp('middle');

        check('mouseDown/mouseUp together call mouseButton exactly twice',
            spy.calls.length === 2);
        check("mouseDown calls ('middle', 'down')",
            spy.calls[0].button === 'middle' && spy.calls[0].direction === 'down');
        check("mouseUp calls ('middle', 'up')",
            spy.calls[1].button === 'middle' && spy.calls[1].direction === 'up');
    } finally {
        spy.restore();
    }
}

// ---------------------------------------------------------------------------
// Group 3 — scroll, via spy
// ---------------------------------------------------------------------------

function testScrollConversion() {
    console.log('\nscroll() / scrollUp() / scrollDown() — pixel-to-detent conversion (spied)');

    const spy = spyOnMouseWheel();
    try {
        mouse.scroll(50);
        mouse.scroll(-30);
        mouse.scrollUp(50);
        mouse.scrollDown(50);

        const expected = [
            Math.round(50 * mouse.SCROLL_UNITS_PER_PIXEL),
            Math.round(-30 * mouse.SCROLL_UNITS_PER_PIXEL),
            Math.round(50 * mouse.SCROLL_UNITS_PER_PIXEL),   // scrollUp(50)
            Math.round(-50 * mouse.SCROLL_UNITS_PER_PIXEL),  // scrollDown(50)
        ];

        check('scroll(50) converts using SCROLL_UNITS_PER_PIXEL',
            spy.calls[0] === expected[0], `got ${spy.calls[0]}, expected ${expected[0]}`);
        check('scroll(-30) converts a negative amount correctly',
            spy.calls[1] === expected[1], `got ${spy.calls[1]}, expected ${expected[1]}`);
        check("scrollUp(50) is positive (matches mouseWheel's \"up\" convention)",
            spy.calls[2] === expected[2] && spy.calls[2] > 0, `got ${spy.calls[2]}`);
        check('scrollDown(50) is negative regardless of sign of n',
            spy.calls[3] === expected[3] && spy.calls[3] < 0, `got ${spy.calls[3]}`);

        // scrollUp/scrollDown should normalize sign even if n is already negative.
        spy.calls.length = 0;
        mouse.scrollUp(-20);
        mouse.scrollDown(-20);
        check('scrollUp(-20) still scrolls up (positive) — magnitude only',
            spy.calls[0] > 0, `got ${spy.calls[0]}`);
        check('scrollDown(-20) still scrolls down (negative) — magnitude only',
            spy.calls[1] < 0, `got ${spy.calls[1]}`);
    } finally {
        spy.restore();
    }
}

// ---------------------------------------------------------------------------
// Group 4 — plotRoute re-export identity
// ---------------------------------------------------------------------------

function testPlotRouteReExport() {
    console.log('\nmouse.plotRoute — re-exported, not reimplemented');
    check('mouse.plotRoute is the exact same function as lib/path/route_executor.plotRoute',
        mouse.plotRoute === plotRoute);
}

// ---------------------------------------------------------------------------
// Group 5 — moveTo, real cursor movement
// ---------------------------------------------------------------------------

async function testMoveToDefaultProvider() {
    console.log('\nmoveTo() — real cursor movement, default provider (linearPath)');

    const to = { x: 350, y: 250 };
    await mouse.moveTo(to);
    await sleep(50);

    const finalPos = screen.getCursorPosition();
    check('cursor lands on target (within tolerance) using the default provider',
        isWithinTolerance(finalPos, to),
        `got (${finalPos.x}, ${finalPos.y}), expected (${to.x}, ${to.y}) ±${CURSOR_TOLERANCE_PX}px`);
}

async function testMoveToCustomProvider() {
    console.log('\nmoveTo() — real cursor movement, custom provider (bezierPath)');

    const to = { x: 700, y: 500 };
    await mouse.moveTo(to, { provider: bezierPath });
    await sleep(50);

    const finalPos = screen.getCursorPosition();
    check('cursor lands on target (within tolerance) using a custom provider (bezierPath)',
        isWithinTolerance(finalPos, to),
        `got (${finalPos.x}, ${finalPos.y}), expected (${to.x}, ${to.y}) ±${CURSOR_TOLERANCE_PX}px`);
}

// ---------------------------------------------------------------------------
// Group 6 — real drag-selection smoke test (mouseDown + moveTo + mouseUp)
// ---------------------------------------------------------------------------

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

async function testDragSelectionSmoke() {
    console.log('\nmouseDown + moveTo + mouseUp — manual drag-selection smoke test');
    console.log('  (loose check: SOME text got selected, not an exact substring —');
    console.log('   exact selection bounds depend on Notepad font metrics / DPI.)');

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

    try {
        screen.focusWindowByHandle(notepadWindow.handle);
        await sleep(200);

        await keyboard.typeText('alpha beta gamma delta epsilon zeta', { charDelay: 0 });
        await sleep(100);

        // Drag from a point just inside the top-left of the client area to a
        // point further right along the (presumably) first line of text.
        // These offsets assume classic Windows 10 Notepad chrome (title bar +
        // single menu bar, no ribbon). Adjust if testing on a different
        // Notepad UI version or DPI scaling.
        const dragStart = { x: notepadWindow.position.x + 15, y: notepadWindow.position.y + 55 };
        const dragEnd = { x: notepadWindow.position.x + 200, y: notepadWindow.position.y + 55 };

        await mouse.moveTo(dragStart);
        mouse.mouseDown('left');
        try {
            await mouse.moveTo(dragEnd);
        } finally {
            // Caller's own responsibility per spec §9 — guarantee release.
            mouse.mouseUp('left');
        }
        await sleep(100);

        await keyboard.keyChord(['control'], 'c');
        await sleep(100);
        const selected = addon.clipboardGetText();

        check('a drag composed from mouseDown+moveTo+mouseUp selected SOME non-empty text',
            typeof selected === 'string' && selected.length > 0,
            `got '${selected}'`);
    } finally {
        screen.closeWindow(notepadWindow.handle);
        await sleep(300);
        const stillPresent = screen.getWindows().find(w => w.handle === notepadWindow.handle);
        if (stillPresent) {
            try { child.kill(); } catch (_) { /* ignore */ }
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== lib/mouse.js test suite (spec §9) ===');

    await testInvalidButtonValidation();

    await testClickSequenceAndTiming();
    await testClickDefaultNoDwell();
    await testDoubleClickSequenceAndTiming();
    await testTripleClickSequenceAndTiming();
    await testMouseDownUp();

    testScrollConversion();
    testPlotRouteReExport();

    await testMoveToDefaultProvider();
    await testMoveToCustomProvider();

    await testDragSelectionSmoke();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('Unhandled error in test run:', err);
    process.exitCode = 1;
});
