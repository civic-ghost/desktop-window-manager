// test/screen.test.js — manual test harness for lib/screen.js (spec §13).
//
// Run from the test/ folder:
//   node screen.test.js
//
// This is a plain pass/fail harness, not a framework — consistent with the
// project's existing test.js. Window-manipulation tests (move/resize/close)
// spawn a throwaway Notepad instance as their target rather than touching
// whatever window happens to be focused. Capture tests write JPEG files to
// disk in this folder so results can be opened and eyeballed, per §13
// ("write test cases that produce verifiable artifacts").

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const screen = require('../lib/screen');

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

function isJpeg(buffer) {
    return Buffer.isBuffer(buffer) &&
        buffer.length > 3 &&
        buffer[0] === 0xff && buffer[1] === 0xd8 &&
        buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

function isWindowShape(w) {
    return w &&
        typeof w.handle === 'number' &&
        typeof w.pid === 'number' &&
        typeof w.className === 'string' &&
        typeof w.title === 'string' &&
        w.position && typeof w.position.x === 'number' && typeof w.position.y === 'number' &&
        w.size && typeof w.size.width === 'number' && typeof w.size.height === 'number';
}

// ---------------------------------------------------------------------------
// Window queries (no side effects — safe to run against whatever is open)
// ---------------------------------------------------------------------------

function testGetWindows() {
    console.log('\ngetWindows()');
    const windows = screen.getWindows();
    check('returns an array', Array.isArray(windows));
    check('array is non-empty', windows.length > 0);
    if (windows.length > 0) {
        check('entries have expected shape', windows.every(isWindowShape),
            JSON.stringify(windows.find(w => !isWindowShape(w))));
    }
    return windows;
}

function testGetActiveWindow() {
    console.log('\ngetActiveWindow()');
    const active = screen.getActiveWindow();
    check('returns null or a well-shaped window',
        active === null || isWindowShape(active),
        JSON.stringify(active));
}

function testGetCursorPosition() {
    console.log('\ngetCursorPosition()');
    const pos = screen.getCursorPosition();
    check('returns {x, y} numbers',
        pos && typeof pos.x === 'number' && typeof pos.y === 'number',
        JSON.stringify(pos));
}

// ---------------------------------------------------------------------------
// Capture (writes JPEGs to this folder for visual inspection)
// ---------------------------------------------------------------------------

function testCaptureScreen() {
    console.log('\ncaptureScreen()');

    const primary = screen.captureScreen('primary', 80);
    check('primary: returns a JPEG buffer', isJpeg(primary), `length=${primary && primary.length}`);
    fs.writeFileSync(path.join(__dirname, 'capture-primary.jpg'), primary);

    const all = screen.captureScreen('all', 80);
    check('all: returns a JPEG buffer', isJpeg(all), `length=${all && all.length}`);
    fs.writeFileSync(path.join(__dirname, 'capture-all.jpg'), all);

    const byIndex = screen.captureScreen(0, 80);
    check('monitor index 0: returns a JPEG buffer', isJpeg(byIndex), `length=${byIndex && byIndex.length}`);
    fs.writeFileSync(path.join(__dirname, 'capture-monitor0.jpg'), byIndex);

    // Default args
    const defaulted = screen.captureScreen();
    check('defaults to primary/quality 80', isJpeg(defaulted));
}

function testCaptureDesktopAlias() {
    console.log('\ncaptureDesktop() [deprecated alias]');
    const viaAlias = screen.captureDesktop(80);
    check('deprecated alias returns a JPEG buffer', isJpeg(viaAlias), `length=${viaAlias && viaAlias.length}`);
    fs.writeFileSync(path.join(__dirname, 'capture-desktop-alias.jpg'), viaAlias);
}

// ---------------------------------------------------------------------------
// Window manipulation — against a throwaway Notepad instance
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

async function testWindowManipulation() {
    console.log('\nWindow manipulation (move/resize/focus/close) via throwaway Notepad');

    const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
    let notepadWindow;

    try {
        notepadWindow = await findWindowByPid(child.pid);
        check('spawned Notepad window found via getWindows()/pid', !!notepadWindow);
    } catch (err) {
        check('spawned Notepad window found via getWindows()/pid', false, err.message);
        try { child.kill(); } catch (_) { /* ignore */ }
        return;
    }

    const handle = notepadWindow.handle;

    // moveWindow
    const targetPos = { x: 100, y: 100 };
    const moveResult = screen.moveWindow(handle, targetPos.x, targetPos.y);
    check('moveWindow() returns true', moveResult === true);
    await sleep(200);
    const afterMove = screen.getWindows().find(w => w.handle === handle);
    check('window position updated after moveWindow()',
        afterMove && afterMove.position.x === targetPos.x && afterMove.position.y === targetPos.y,
        afterMove ? JSON.stringify(afterMove.position) : 'window not found');

    // resizeWindow
    const targetSize = { width: 640, height: 480 };
    const resizeResult = screen.resizeWindow(handle, targetSize.width, targetSize.height);
    check('resizeWindow() returns true', resizeResult === true);
    await sleep(200);
    const afterResize = screen.getWindows().find(w => w.handle === handle);
    check('window size updated after resizeWindow()',
        afterResize && afterResize.size.width === targetSize.width && afterResize.size.height === targetSize.height,
        afterResize ? JSON.stringify(afterResize.size) : 'window not found');

    // focusWindowByHandle
    const focusByHandleResult = screen.focusWindowByHandle(handle);
    check('focusWindowByHandle() returns true', focusByHandleResult === true);
    await sleep(200);
    const activeAfterFocus = screen.getActiveWindow();
    check('getActiveWindow() reflects focusWindowByHandle()',
        activeAfterFocus && activeAfterFocus.handle === handle,
        activeAfterFocus ? JSON.stringify(activeAfterFocus) : 'null');

    // focusWindow (title substring — Notepad's title includes "Notepad")
    const focusByTitleResult = screen.focusWindow('notepad');
    check('focusWindow() by title substring returns true', focusByTitleResult === true);

    // focusWindowByPid — the new composition under test
    const focusByPidResult = screen.focusWindowByPid(child.pid);
    check('focusWindowByPid() returns true for the spawned process', focusByPidResult === true);
    await sleep(200);
    const activeAfterPidFocus = screen.getActiveWindow();
    check('getActiveWindow() reflects focusWindowByPid()',
        activeAfterPidFocus && activeAfterPidFocus.handle === handle,
        activeAfterPidFocus ? JSON.stringify(activeAfterPidFocus) : 'null');

    // focusWindowByPid — negative case, a pid that (almost certainly) owns no window
    const bogusPid = 999999;
    const focusByPidBogus = screen.focusWindowByPid(bogusPid);
    check('focusWindowByPid() returns false for a non-existent pid', focusByPidBogus === false);

    // captureWindow — exercise against the live Notepad window
    const windowCapture = screen.captureWindow(handle, 80);
    check('captureWindow() returns a JPEG buffer', isJpeg(windowCapture), `length=${windowCapture && windowCapture.length}`);
    fs.writeFileSync(path.join(__dirname, 'capture-notepad-window.jpg'), windowCapture);

    // closeWindow
    const closeResult = screen.closeWindow(handle);
    check('closeWindow() returns true', closeResult === true);
    await sleep(300);
    const stillPresent = screen.getWindows().find(w => w.handle === handle);
    check('window no longer enumerated after closeWindow()', !stillPresent);

    // Safety net in case Notepad prompted or otherwise survived
    if (stillPresent) {
        try { child.kill(); } catch (_) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== lib/screen.js test suite ===');

    testGetWindows();
    testGetActiveWindow();
    testGetCursorPosition();
    testCaptureScreen();
    testCaptureDesktopAlias();
    await testWindowManipulation();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('Unhandled error in test run:', err);
    process.exitCode = 1;
});
