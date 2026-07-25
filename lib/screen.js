// lib/screen.js — Screen & window composition layer (spec §9).
//
// JPEG encoding (via jpeg-js) for capture functions lives here, not in
// the native layer. Pass-throughs re-export the native primitive unchanged.
// focusWindowByPid is the one genuine composition: filter getWindows() by
// owning PID and focus the match.

const addon = require('./addon');
const jpeg = require('jpeg-js');

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

/**
 * Encode a raw RGBA capture result to a JPEG Buffer.
 * @param {{data: Buffer, width: number, height: number}} raw
 * @param {number} quality  JPEG quality 1-100
 * @returns {Buffer} JPEG image data
 */
function encodeJpeg(raw, quality) {
    const jpegData = jpeg.encode({
        data: raw.data,
        width: raw.width,
        height: raw.height,
    }, quality);
    return jpegData.data;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Capture a screen region as a JPEG buffer.
 *
 * @param {string|number} [target='primary']
 *   - `'primary'` — the primary monitor (default)
 *   - `'all'`     — the full virtual desktop across all monitors
 *   - `number`    — 0-based monitor index
 * @param {number} [quality=80] JPEG quality 1-100
 * @returns {Buffer} JPEG image data
 */
function captureScreen(target = 'primary', quality = 80) {
    const raw = addon.captureScreen(target);
    return encodeJpeg(raw, quality);
}

/**
 * Capture a specific window as a JPEG buffer.
 *
 * @param {number} handle  Window handle from getWindows() or getActiveWindow()
 * @param {number} [quality=80] JPEG quality 1-100
 * @returns {Buffer} JPEG image data
 */
function captureWindow(handle, quality = 80) {
    const raw = addon.captureWindow(handle);
    return encodeJpeg(raw, quality);
}

/**
 * @deprecated Use captureScreen('primary', quality) instead.
 *
 * Capture the primary desktop as a JPEG buffer. Retained as a convenience
 * alias during migration; will be removed in a future release.
 *
 * @param {number} [quality=80] JPEG quality 1-100
 * @returns {Buffer} JPEG image data
 */
function captureDesktop(quality = 80) {
    return captureScreen('primary', quality);
}

// ---------------------------------------------------------------------------
// Window queries & manipulation — pass-throughs
// ---------------------------------------------------------------------------

/**
 * Get all visible top-level windows.
 *
 * Tool windows (WS_EX_TOOLWINDOW) are excluded; windows with no title are
 * included and can be identified by `className`.
 *
 * @returns {Array<{
 *   handle: number,
 *   pid: number,
 *   className: string,
 *   title: string,
 *   position: {x: number, y: number},
 *   size: {width: number, height: number}
 * }>}
 */
function getWindows() {
    return addon.getWindows();
}

/**
 * Get the currently active/focused window.
 *
 * @returns {{
 *   handle: number,
 *   pid: number,
 *   className: string,
 *   title: string,
 *   position: {x: number, y: number},
 *   size: {width: number, height: number}
 * } | null} Active window, or null if there is no foreground window
 */
function getActiveWindow() {
    return addon.getActiveWindow();
}

/**
 * Focus a window by title (case-insensitive substring match or regex).
 *
 * @param {string} titlePattern  Window title to search for
 * @param {boolean} [useRegex=false]  Treat pattern as regex
 * @returns {boolean} True if a window was found and focused
 */
function focusWindow(titlePattern, useRegex = false) {
    return addon.focusWindow(titlePattern, useRegex);
}

/**
 * Focus a window by its handle.
 *
 * @param {number} handle  Window handle from getWindows()
 * @returns {boolean} True if the window was focused
 */
function focusWindowByHandle(handle) {
    return addon.focusWindowByHandle(handle);
}

/**
 * Focus a window by owning process ID.
 *
 * Composition over getWindows(): finds the first window whose `pid` matches
 * and focuses it. Preferred over title matching when the caller knows the
 * target process.
 *
 * @param {number} pid  Process ID of the window's owning process
 * @returns {boolean} True if a window was found and focused
 */
function focusWindowByPid(pid) {
    const windows = addon.getWindows();
    const match = windows.find(w => w.pid === pid);
    if (!match) return false;
    return addon.focusWindowByHandle(match.handle);
}

/**
 * Ask a window to close.
 *
 * Fire-and-forget: posts WM_CLOSE and returns immediately. The return value
 * indicates whether the post succeeded, NOT whether the window closed.
 *
 * @param {number} handle  Window handle
 * @returns {boolean} True if WM_CLOSE was posted successfully
 */
function closeWindow(handle) {
    return addon.closeWindow(handle);
}

/**
 * Move a window's top-left corner to (x, y).
 *
 * @param {number} handle  Window handle
 * @param {number} x  New X position
 * @param {number} y  New Y position
 * @returns {boolean} True if the window was moved
 */
function moveWindow(handle, x, y) {
    return addon.moveWindow(handle, x, y);
}

/**
 * Resize a window to width × height.
 *
 * @param {number} handle  Window handle
 * @param {number} width   New width
 * @param {number} height  New height
 * @returns {boolean} True if the window was resized
 */
function resizeWindow(handle, width, height) {
    return addon.resizeWindow(handle, width, height);
}

// ---------------------------------------------------------------------------
// Cursor — pass-through (listed in §9 screen section)
// ---------------------------------------------------------------------------

/**
 * Get the current cursor position in absolute physical pixels.
 *
 * @returns {{x: number, y: number}}
 */
function getCursorPosition() {
    return addon.getCursorPosition();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // Capture
    captureScreen,
    captureWindow,
    captureDesktop,   // deprecated alias

    // Window queries & manipulation
    getWindows,
    getActiveWindow,
    focusWindow,
    focusWindowByHandle,
    focusWindowByPid,
    closeWindow,
    moveWindow,
    resizeWindow,

    // Cursor
    getCursorPosition,
};
